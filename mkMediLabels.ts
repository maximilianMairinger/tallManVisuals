#!/usr/bin/env bun
import * as fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { Command } from 'commander';

const PANTONE_TO_HEX: Record<string, string> = {
    "Salmon 156": "#F29D70",
    "Green 367": "#A4D65E",
    "Orange 151": "#FF8200",
    "Process yellow C": "#FFE900",
    "Grey 401": "#C8C9C7",
    "Warm red": "#F9423A",
    "Blue 297": "#71C5E8",
    "Violet 256": "#D8B5D5",
    "White": "#FFFFFF",
    "Black": "#000000"
};

interface MedClass {
    backgroundColor: string;
    secondaryBackgroundColor?: string;
    textColor: string;
    unitTextColor: string;
    isStriped: boolean;
    isSplit: boolean;
    hasBorder: boolean;
    borderColor?: string;
}

export interface InputMed {
    name: string;
    userClass?: string;
}

// --- Helper Functions ---

function parseTallmanCSV(filePath: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Warning: Could not find ${filePath}`);
        return map;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let currentField = '';
    let isQuoted = false;
    let isFirstField = true;
    let currentMed = '';

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const nextChar = content[i + 1];

        if (char === '"') {
            if (isQuoted && nextChar === '"') {
                currentField += '"';
                i++; 
            } else {
                isQuoted = !isQuoted;
            }
        } else if (char === ',' && !isQuoted) {
            if (isFirstField) {
                currentMed = currentField.trim();
                isFirstField = false;
            }
            currentField = '';
        } else if (char === '\n' && !isQuoted) {
            if (isFirstField) currentMed = currentField.trim();
            
            if (currentMed && currentMed.toLowerCase() !== 'medicine') {
                const cleanMed = currentMed.replace(/\*$/, '');
                map.set(cleanMed.toLowerCase(), cleanMed);
            }
            currentField = '';
            isFirstField = true;
            currentMed = '';
        } else {
            currentField += char;
        }
    }
    
    if (isFirstField && currentField) currentMed = currentField.trim();
    if (currentMed && currentMed.toLowerCase() !== 'medicine') {
        const cleanMed = currentMed.replace(/\*$/, '');
        map.set(cleanMed.toLowerCase(), cleanMed);
    }

    return map;
}

function parseMedsArray(items: string[]): InputMed[] {
    return items.map(item => {
        const match = item.match(/^(.*?)(?:\s*\((.*?)\))?$/);
        if (match) {
            return {
                name: match[1].trim(),
                userClass: match[2] ? match[2].trim() : undefined
            };
        }
        return { name: item };
    });
}

function parseMedsString(content: string): InputMed[] {
    const items = content.split(',').map(m => m.trim()).filter(m => m.length > 0);
    return parseMedsArray(items);
}

function parseInputMeds(filePath: string): InputMed[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseMedsString(content);
}

function formatTallmanSVG(medName: string): string {
    const parts = medName.split(/([A-ZÄÖÜ]+)/);
    // Figma BUG workaround: If the text starts directly with a bold tspan, Figma forces the whole block to be bold.
    // Injecting an invisible normal zero-width-space tspan perfectly roots Figma's initial text node state.
    const figmaBugFixPrefix = `<tspan font-weight="normal">&#8203;</tspan>`;
    
    const formed = parts.map(part => {
        if (!part) return '';
        if (/^[A-ZÄÖÜ]+$/.test(part)) {
            return `<tspan font-weight="bold">${part}</tspan>`;
        } else {
            return `<tspan font-weight="normal">${part}</tspan>`;
        }
    }).join('');
    
    return figmaBugFixPrefix + formed;
}

function generateSVG(medName: string, medClass: MedClass, dosageText: string, isAutoDosage: boolean, paddingScale: number, sizeScale: number): string {
    const bgHex = PANTONE_TO_HEX[medClass.backgroundColor] || '#FFFFFF';
    const textHex = PANTONE_TO_HEX[medClass.textColor] || '#000000';
    const unitTextHex = PANTONE_TO_HEX[medClass.unitTextColor] || '#000000';
    
    // --- Proportional Layout Engine ---
    
    // Constants: The physical pixel size of the text (approximate bounds)
    const text1Ascent = 24 * sizeScale;  // Height above baseline for 32px font
    const text1Descent = 8 * sizeScale;  // Height below baseline for 32px font
    const text1H = text1Ascent + text1Descent; 
    const text2Ascent = 16 * sizeScale;  // Height above baseline for 22px font
    const text2Descent = 5 * sizeScale;  // Height below baseline for 22px font
    const text2H = text2Ascent + text2Descent;
    const totalSolidH = text1H + text2H;

    // Variables: Elastic Padding blocks (Base sum = 67 when P=1.0)
    const topEmpty = (medClass.isSplit ? 14 : 29) * paddingScale * sizeScale;
    const midEmpty = (medClass.isSplit ? 33 : 18) * paddingScale * sizeScale;
    const botEmpty = 20 * paddingScale * sizeScale;
    
    // Canvas Math
    const newHeight = topEmpty + midEmpty + botEmpty + totalSolidH; 
    const newWidth = newHeight * 2.5; // Lock aspect ratio exactly
    const rx = 10 * paddingScale * sizeScale; // Scale the rounded corners proportionally

    // Y-Coordinate Map
    const topTextY = topEmpty + text1Ascent; // Exact baseline of top text
    const bottomY = topEmpty + text1H + midEmpty + text2Ascent - (3 * sizeScale); // Exact baseline of bottom text, shifted up slightly
    const splitLineY = topEmpty + text1H + (9 * paddingScale * sizeScale);

    let backgroundSvg = '';

    if (medClass.isStriped && medClass.secondaryBackgroundColor) {
        const stripeHex = PANTONE_TO_HEX[medClass.secondaryBackgroundColor] || '#000000';
        const inset = 15 * paddingScale * sizeScale;
        backgroundSvg = `
            <defs>
                <pattern id="stripes" width="${20 * sizeScale}" height="${20 * sizeScale}" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="${20 * sizeScale}" stroke="${stripeHex}" stroke-width="${15 * sizeScale}" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#stripes)" rx="${rx}" />
            <rect x="${inset}" y="${inset}" width="${newWidth - 2*inset}" height="${newHeight - 2*inset}" fill="#FFFFFF" rx="${rx * 0.5}" />
        `;
    } 
    else if (medClass.isSplit && medClass.secondaryBackgroundColor) {
        const bottomHex = PANTONE_TO_HEX[medClass.secondaryBackgroundColor] || '#000000';
        // Precise Bezier curve math for the top corners so they don't deform during scaling
        const cp = rx * 0.55228; 
        const splitPath = `M 0 ${rx} C 0 ${rx - cp} ${rx - cp} 0 ${rx} 0 L ${newWidth - rx} 0 C ${newWidth - rx + cp} 0 ${newWidth} ${rx - cp} ${newWidth} ${rx} L ${newWidth} ${splitLineY} L 0 ${splitLineY} Z`;
        
        backgroundSvg = `
            <rect width="100%" height="100%" fill="${bottomHex}" rx="${rx}" />
            <path d="${splitPath}" fill="${bgHex}" />
        `;
    }
    else if (medClass.hasBorder && medClass.borderColor) {
        const borderHex = PANTONE_TO_HEX[medClass.borderColor] || '#000000';
        const borderInset = 4 * paddingScale * sizeScale;
        const borderStroke = 8 * paddingScale * sizeScale;
        backgroundSvg = `
            <rect x="${borderInset}" y="${borderInset}" width="${newWidth - 2*borderInset}" height="${newHeight - 2*borderInset}" fill="${bgHex}" stroke="${borderHex}" stroke-width="${borderStroke}" rx="${rx}" />
        `;
    }
    else {
        backgroundSvg = `
            <rect width="100%" height="100%" fill="${bgHex}" rx="${rx}" />
        `;
    }

    const formattedMedName = formatTallmanSVG(medName);
    let bottomTextSvg = '';

    if (isAutoDosage) {
        // Auto-Dosage ON -> Centered text only, NO line
        const parts = dosageText.split(' ');
        if (parts.length > 1) {
            bottomTextSvg = `<text x="50%" y="${bottomY}" text-anchor="middle" font-family="Averta CY" font-size="${22 * sizeScale}" fill="${textHex}"><tspan font-weight="normal">&#8203;</tspan><tspan font-weight="bold">${parts[0]}</tspan><tspan font-weight="normal">&#160;${parts.slice(1).join(' ')}</tspan></text>`;
        } else {
            bottomTextSvg = `<text x="50%" y="${bottomY}" text-anchor="middle" font-family="Averta CY" font-weight="bold" font-size="${22 * sizeScale}" fill="${textHex}">${dosageText}</text>`;
        }
    } else {
        // Auto-Dosage OFF -> Centered Group (Line + Unit text), bottom-aligned
        const lineLen = 90 * paddingScale * sizeScale;
        const gap = 8 * paddingScale * sizeScale;
        const approxTextWidth = dosageText.length * 12.5 * sizeScale; 
        const totalWidth = lineLen + gap + approxTextWidth;
        
        const startX = (newWidth / 2) - (totalWidth / 2);
        const lineX1 = startX;
        const lineX2 = startX + lineLen;
        const textX = lineX2 + gap;

        const parts = dosageText.split(' ');
        if (parts.length > 1) {
            bottomTextSvg = `
                <line x1="${lineX1}" y1="${bottomY}" x2="${lineX2}" y2="${bottomY}" stroke="${textHex}" stroke-width="${2.5 * sizeScale}" stroke-dasharray="${4 * sizeScale},${8 * sizeScale}" stroke-linecap="round" />
                <text x="${textX}" y="${bottomY}" text-anchor="start" font-family="Averta CY" font-size="${22 * sizeScale}" fill="${textHex}"><tspan font-weight="normal">&#8203;</tspan><tspan font-weight="bold">${parts[0]}</tspan><tspan font-weight="normal">&#160;${parts.slice(1).join(' ')}</tspan></text>
            `;
        } else {
            bottomTextSvg = `
                <line x1="${lineX1}" y1="${bottomY}" x2="${lineX2}" y2="${bottomY}" stroke="${textHex}" stroke-width="${2.5 * sizeScale}" stroke-dasharray="${4 * sizeScale},${8 * sizeScale}" stroke-linecap="round" />
                <text x="${textX}" y="${bottomY}" text-anchor="start" font-family="Averta CY" font-weight="bold" font-size="${22 * sizeScale}" fill="${textHex}">${dosageText}</text>
            `;
        }
    }

    const textSvg = `
        <text x="50%" y="${topTextY}" text-anchor="middle" font-family="Averta CY" font-size="${32 * sizeScale}" fill="${textHex}">${formattedMedName}</text>
        ${bottomTextSvg}
    `;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${newWidth}" height="${newHeight}" viewBox="0 0 ${newWidth} ${newHeight}">
        ${backgroundSvg}
        ${textSvg}
    </svg>`;
}

export interface GenerateMediLabelsOptions {
    medications: InputMed[];
    apiKey: string;
    classesPath?: string;
    germanPath?: string;
    englishPath?: string;
    languagePriority?: 'german' | 'english';
    outputDir?: string;
    autoDosage?: boolean;
    concentration?: boolean;
    route?: boolean;
    scale?: number | string;
    sizeScale?: number | string;
    modelName?: string;
}

export async function generateMediLabels(options: GenerateMediLabelsOptions) {
    let scaleInputValueStr = options.scale;
    if (typeof options.scale === 'boolean' || options.scale === undefined) scaleInputValueStr = '1.0';
    const scaleInputValue = typeof scaleInputValueStr === 'number' ? scaleInputValueStr : parseFloat(scaleInputValueStr as string);
    if (isNaN(scaleInputValue) || scaleInputValue <= 0) {
        throw new Error("Error: scale must be a number greater than 0.");
    }
    const paddingScale = 1 / (scaleInputValue * 1.5);

    let sizeScaleValueStr = options.sizeScale;
    if (typeof options.sizeScale === 'boolean' || options.sizeScale === undefined) sizeScaleValueStr = '1.0';
    const parsedSizeScale = typeof sizeScaleValueStr === 'number' ? sizeScaleValueStr : parseFloat(sizeScaleValueStr as string);
    if (isNaN(parsedSizeScale) || parsedSizeScale <= 0) {
        throw new Error("Error: size-scale must be a number greater than 0.");
    }
    const sizeScale = parsedSizeScale * 0.9;

    const classesPath = options.classesPath || 'classes.json';
    const germanPath = options.germanPath || 'tallmanGer.csv';
    const englishPath = options.englishPath || 'tallmanEngl.csv';
    const languagePriority = options.languagePriority || 'german';
    const outputDir = options.outputDir || './labels';
    const autoDosage = options.autoDosage || false;
    const concentration = options.concentration || false;
    const route = options.route || false;
    const modelName = options.modelName || 'gemini-3.1-flash-lite-preview';


    const prompt = (promptStr: string) => {
        return {
            model: modelName,
            contents: promptStr,
            config: {
                thinkingConfig: {
                    thinkingLevel: 'low',
                },
            },
        }
    }

    if (!options.apiKey) {
        throw new Error("Missing Google Gemini API Key. Expected 'apiKey' in the generator options or process.env.GEMINI_API_KEY.");
    }
    const ai = new GoogleGenAI({ apiKey: options.apiKey });

    if (!fs.existsSync(classesPath)) {
        throw new Error(`Error: Missing classes definition file at ${classesPath}`);
    }
    const classesData: Record<string, MedClass> = JSON.parse(fs.readFileSync(classesPath, 'utf-8'));
    const validTargetKeys = Object.keys(classesData).filter(k => !['adrenaline', 'suxamethonium', 'protamine'].includes(k));
    
    const tallmanMap = new Map<string, string>();
    const englishMap = parseTallmanCSV(englishPath);
    const germanMap = parseTallmanCSV(germanPath);

    if (languagePriority === 'english') {
        for (const [key, val] of germanMap.entries()) { tallmanMap.set(key, val); }
        for (const [key, val] of englishMap.entries()) { tallmanMap.set(key, val); }
    } else {
        for (const [key, val] of englishMap.entries()) { tallmanMap.set(key, val); }
        for (const [key, val] of germanMap.entries()) { tallmanMap.set(key, val); }
    }

    console.log(`Loaded ${tallmanMap.size} unique Tall Man lettering entries.`);
    console.log(`Auto-dosage resolution: ${autoDosage ? "ON" : "OFF"}`);
    console.log(`Resolution Mode: ${concentration ? "Concentration (e.g., mg/ml)" : "Absolute Bolus Dose (e.g., mg)"}`);
    console.log(`Text Scale: ${scaleInputValue} (Padding Multiplier: ${paddingScale.toFixed(2)})`);
    console.log(`Size Scale: ${sizeScale}`);

    if (options.medications.length === 0) {
        console.log(`No medications provided.`);
        return;
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const promises = options.medications.map(async (inputObj) => {
        const rawName = inputObj.name;
        const searchKey = rawName.toLowerCase();
        const tallmanName = tallmanMap.get(searchKey) || rawName;
        
        console.log(`\nProcessing: ${tallmanName} (Original input: ${rawName})`);
        if (inputObj.userClass) {
            console.log(` > User suggested class: ${inputObj.userClass}`);
        }

        let assignedClass = "";
        let classPromise: Promise<string>;
        let dosagePromise: Promise<string>;
        
        // 1. Setup Class Promise
        if (!inputObj.userClass && (searchKey === "adrenaline" || searchKey === "epinephrine")) {
            classPromise = Promise.resolve("adrenaline");
        } else if (!inputObj.userClass && searchKey === "suxamethonium") {
            classPromise = Promise.resolve("suxamethonium");
        } else if (!inputObj.userClass && (searchKey === "protamine" || searchKey === "protamin")) {
            classPromise = Promise.resolve("protamine");
        } else {
            let userClassNote = "";
            if (inputObj.userClass) {
                userClassNote = `The user strongly suggests this medication belongs to the category: "${inputObj.userClass}". Consider this hint carefully if it matches one of the expected classifications. `;
            }

            const classPrompt = `
            You are a medical expert categorizing drugs for ISO standard syringe labels.
            Classify the medication "${tallmanName}".
            ${userClassNote}
            It must be EXACTLY ONE of these categories, nothing else:
            ${validTargetKeys.join(", ")}
            
            Instructions:
            1. Output ONLY the exact category name from the list above. No quotes, no explanation, no period.
            2. If you are not absolutely sure, or if it doesn't clearly fit into any specific category, output "Other".
            `;

            const startClassTiming = performance.now();
            classPromise = ai.models.generateContent(prompt(classPrompt)).then(res => {
                console.log(` > [Timing] Class API: ${(performance.now() - startClassTiming).toFixed(0)}ms`);
                let text = (res.text || '').trim();
                let matchingKey = validTargetKeys.find(k => k.toLowerCase() === text.toLowerCase());
                
                if (matchingKey) return matchingKey;

                matchingKey = validTargetKeys.find(k => text.toLowerCase().includes(k.toLowerCase()));
                if (matchingKey) return matchingKey;

                return "Other";
            }).catch(err => {
                console.error(`❌ API Error classifying ${tallmanName}:`, err);
                return "Other";
            });
        }

        // 2. Setup Dosage Promise
        let dosagePrompt = '';
        if (autoDosage) {
            if (concentration) {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard pre-filled syringe or standard ampule/drawing concentration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the numerical value, unit${route ? ', and administration route' : ''} (e.g., "1 mg/ml"${route ? ' i.v.' : ''}, "50 mcg/ml", "1000 IE/ml", "0.5 mg/ml").
                2. Do not include any text, markdown, or explanation.
                3. If there are multiple, provide the single most common adult emergency concentration. DO NOT provide ranges or weight-based doses.
                `;
            } else {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard absolute single-dose for one-time IV bolus or single-dose inhalation/application administration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the numerical value, unit${route ? ', and administration route' : ''} (e.g., "5 mg"${route ? ' i.v.' : ''}, "1 g", "50 mcg", "10 IE", "3 ml"${route ? ' inh.' : ''}).
                2. Do not include any text, markdown, or explanation.
                3. If there are multiple, provide the single most common adult emergency bolus/single dose. DO NOT provide ranges or weight-based doses.
                `;
            }
        } else {
            // Auto dosage OFF -> Infer ONLY the Unit (no numbers)
            if (concentration) {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard unit of concentration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the unit itself${route ? ' and administration route' : ''} (e.g., "mg/ml"${route ? ' i.v.' : ''}, "mcg/ml", "IE/ml").
                2. DO NOT include any numbers.
                3. Do not include any text, markdown, or explanation.
                `;
            } else {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard unit for an absolute single-dose IV bolus of the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the unit itself${route ? ' and administration route' : ''} (e.g., "mg"${route ? ' i.v.' : ''}, "mcg", "g", "IE").
                2. DO NOT include any numbers.
                3. Do not include any text, markdown, or explanation.
                `;
            }
        }
        
        const startDosageTiming = performance.now();
        dosagePromise = ai.models.generateContent(prompt(dosagePrompt)).then(res => {
            console.log(` > [Timing] Dosage API: ${(performance.now() - startDosageTiming).toFixed(0)}ms`);
            let text = (res.text || '').trim();
            
            if (text.length > 25 || text.includes('\n')) {
                return concentration ? "mg/ml" : "mg";
            }
            
            // Remove space between number and unit for aesthetic grouping (1 mg -> 1mg)
            text = text.replace(/([\d.])\s+([a-zA-Zμµ])/g, '$1$2').trim();

            if (!autoDosage) {
                text = text.replace(/[0-9.]/g, '').trim();
                if (!text) return concentration ? "mg/ml" : "mg";
            }
            
            return text;
        }).catch(err => {
            console.error(`❌ API Error fetching dosage for ${tallmanName}:`, err);
            return concentration ? "mg/ml" : "mg";
        });

        // Execute API calls concurrently
        const[resolvedClass, resolvedDosage] = await Promise.all([classPromise, dosagePromise]);
        
        assignedClass = resolvedClass;
        console.log(` > Assigned Class: ${assignedClass}`);
        console.log(` > Discovered Text: ${resolvedDosage}`);

        const classStyle = classesData[assignedClass] || classesData["Other"];
        const svgContent = generateSVG(tallmanName, classStyle, resolvedDosage, autoDosage, paddingScale, sizeScale);
        const safeFilename = tallmanName.replace(/[^a-zA-Z0-9]/gi, '_');
        const outputPath = `${outputDir}/${safeFilename}.svg`;
        
        fs.writeFileSync(outputPath, svgContent);
        console.log(` > Saved to ${outputPath}`);
    });

    await Promise.all(promises);

    console.log("\nDone!");
}

async function main() {
    // --- CLI Setup using Commander ---
    const program = new Command();
    
    program
        .name('mkMediLabels')
        .description(`Generates styled SVG syringe labels based on ISO color standards using LLM categorization.
        
TLDR:
Generates ISO-compliant syringe labels as scalable SVGs. It uses the Gemini API to map medications to 
standardized color classes (e.g., Opioids = Blue), applies Tall Man lettering for safety, and can optionaly 
predict standard absolute dosages or concentrations.

Examples:
  bun run mkMediLabels.ts -f input_meds.txt
  bun run mkMediLabels.ts -m "Amiodaron, Fentanyl"
  bun run mkMediLabels.ts Adrenalin Suxamethonium "Propofol (Hypnotics)"`)
        .version('1.0.0')
        .option('-c, --classes <path>', 'Path to classes.json', 'classes.json')
        .option('-g, --german <path>', 'Path to tallmanGer.csv', 'tallmanGer.csv')
        .option('-e, --english <path>', 'Path to tallmanEngl.csv', 'tallmanEngl.csv')
        .option('-l, --language-priority <german|english>', 'Which language takes precedence for Tall Man lettering matching', 'german')        
        .option('-f, --medications-file <path>', 'Path to the input text file (comma separated)', 'input_meds.txt')
        .option('-m, --medications <string>', 'Direct input of medications as a comma-separated string')
        .option('-o, --output <dir>', 'Directory to save the generated SVG files', './labels')
        .option('-a, --auto-dosage', 'Automatically fetch absolute adult IV bolus dosages (e.g., 5 mg) via API', false)
        .option('-C, --concentration', 'If auto-dosage is enabled, fetch concentration (e.g., 10 mg/ml). If disabled, infers concentration unit.', false)
        .option('-r, --route', 'Include administration route (e.g. i.v., inh.) next to the dosage/concentration', false)
        .option('-s, --scale <number>', 'Scale multiplier for text relative to label size. Larger means smaller padding (default: 1.0)', '1.0')
        .option('-S, --size-scale <number>', 'Scale multiplier for the entire SVG size linearly (default: 1.0)', '1.0')
        .option('--model <string>', 'Gemini API model to use', 'gemini-3-flash-preview')
        .option('-k, --api-key <string>', 'Gemini API key as plaintext')
        .option('-K, --api-key-file <path>', 'Path to file containing Gemini API key')
        .argument('[meds...]', 'Direct medications as positional arguments');

    program.parse(process.argv);
    const options = program.opts();

    // --- Core Inversion Math ---
    
    let apiKey = process.env.GEMINI_API_KEY;
    if (options.apiKey) {
        apiKey = options.apiKey;
    } else if (options.apiKeyFile) {
        if (!fs.existsSync(options.apiKeyFile)) {
            console.error(`Error: API key file not found at ${options.apiKeyFile}`);
            process.exit(1);
        }
        apiKey = fs.readFileSync(options.apiKeyFile, 'utf-8').trim();
    }

    if (!apiKey) {
        console.error("\x1b[31mError: Missing Google Gemini API Key!\x1b[0m\n");
        console.error("This tool requires a Gemini API key to intelligently categorize medications and predict dosages.");
        console.error("You can get a free API key here: \x1b[34mhttps://aistudio.google.com/app/apikey\x1b[0m\n");
        console.error("Once you have the key, provide it by either:");
        console.error("  1. Exporting the environment variable: \x1b[33mexport GEMINI_API_KEY='your_key'\x1b[0m");
        console.error("  2. Passing it via the CLI flag: \x1b[33m--api-key 'your_key'\x1b[0m");
        process.exit(1);
    }

    let inputMeds: InputMed[] = [];
    if (program.args.length > 0) {
        inputMeds = parseMedsArray(program.args);
    } else if (options.medications) {
        inputMeds = parseMedsString(options.medications);
    } else {
        inputMeds = parseInputMeds(options.medicationsFile);
    }

    if (inputMeds.length === 0) {
        console.log(`No medications found in inputs or ${options.medicationsFile}`);
        return;
    }

    try {
        await generateMediLabels({
            medications: inputMeds,
            apiKey: apiKey,
            classesPath: options.classes,
            germanPath: options.german,
            englishPath: options.english,
            languagePriority: options.languagePriority,
            outputDir: options.output,
            autoDosage: options.autoDosage,
            concentration: options.concentration,
            route: options.route,
            scale: options.scale,
            sizeScale: options.sizeScale,
            modelName: options.model
        });
    } catch (e: any) {
        console.error(e.message);
        process.exit(1);
    }
}

if (require.main === module || (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('mkMediLabels.ts'))) {
    main();
}