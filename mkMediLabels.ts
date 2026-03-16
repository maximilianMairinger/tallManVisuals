import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

interface InputMed {
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

function parseInputMeds(filePath: string): InputMed[] {
    if (!fs.existsSync(filePath)) return[];
    const content = fs.readFileSync(filePath, 'utf-8');
    
    const items = content.split(',').map(m => m.trim()).filter(m => m.length > 0);
    
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

function formatTallmanSVG(medName: string): string {
    const parts = medName.split(/([A-Z]+)/);
    return parts.map(part => {
        if (!part) return '';
        if (/^[A-Z]+$/.test(part)) {
            return `<tspan font-weight="bold">${part}</tspan>`;
        } else {
            return `<tspan font-weight="normal">${part}</tspan>`;
        }
    }).join('');
}

function generateSVG(medName: string, medClass: MedClass, dosageText: string, isAutoDosage: boolean, paddingScale: number): string {
    const bgHex = PANTONE_TO_HEX[medClass.backgroundColor] || '#FFFFFF';
    const textHex = PANTONE_TO_HEX[medClass.textColor] || '#000000';
    const unitTextHex = PANTONE_TO_HEX[medClass.unitTextColor] || '#000000';
    
    // --- Proportional Layout Engine ---
    
    // Constants: The physical pixel size of the text (approximate bounds)
    const text1H = 32;
    const text2Ascent = 16;  // Height above baseline for 22px font
    const text2Descent = 5;  // Height below baseline for 22px font
    const text2H = text2Ascent + text2Descent; // 21
    const totalSolidH = text1H + text2H; // 53

    // Variables: Elastic Padding blocks (Base sum = 67 when P=1.0)
    const topEmpty = (medClass.isSplit ? 14 : 29) * paddingScale;
    const midEmpty = (medClass.isSplit ? 33 : 18) * paddingScale;
    const botEmpty = 20 * paddingScale;
    
    // Canvas Math
    const newHeight = topEmpty + midEmpty + botEmpty + totalSolidH; 
    const newWidth = newHeight * 2.5; // Lock aspect ratio exactly
    const rx = 10 * paddingScale; // Scale the rounded corners proportionally

    // Y-Coordinate Map
    const topTextY = topEmpty + (text1H / 2); // Center of top text
    const bottomY = topEmpty + text1H + midEmpty + text2Ascent; // Exact baseline of bottom text
    const splitLineY = topEmpty + text1H + (9 * paddingScale);

    let backgroundSvg = '';

    if (medClass.isStriped && medClass.secondaryBackgroundColor) {
        const stripeHex = PANTONE_TO_HEX[medClass.secondaryBackgroundColor] || '#000000';
        const inset = 15 * paddingScale;
        backgroundSvg = `
            <defs>
                <pattern id="stripes" width="20" height="20" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="20" stroke="${stripeHex}" stroke-width="15" />
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
        const borderInset = 4 * paddingScale;
        const borderStroke = 8 * paddingScale;
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
        bottomTextSvg = `<text x="50%" y="${bottomY}" text-anchor="middle" font-family="Averta CY, Arial, sans-serif" font-weight="bold" font-size="22" fill="${unitTextHex}">${dosageText}</text>`;
    } else {
        // Auto-Dosage OFF -> Centered Group (Line + Unit text), bottom-aligned
        const lineLen = 90 * paddingScale;
        const gap = 8 * paddingScale;
        const approxTextWidth = dosageText.length * 12.5; 
        const totalWidth = lineLen + gap + approxTextWidth;
        
        const startX = (newWidth / 2) - (totalWidth / 2);
        const lineX1 = startX;
        const lineX2 = startX + lineLen;
        const textX = lineX2 + gap;

        bottomTextSvg = `
            <line x1="${lineX1}" y1="${bottomY}" x2="${lineX2}" y2="${bottomY}" stroke="${unitTextHex}" stroke-width="2.5" stroke-dasharray="4,8" stroke-linecap="round" />
            <text x="${textX}" y="${bottomY}" text-anchor="start" font-family="Averta CY, Arial, sans-serif" font-weight="bold" font-size="22" fill="${unitTextHex}">${dosageText}</text>
        `;
    }

    const textSvg = `
        <text x="50%" y="${topTextY}" dominant-baseline="middle" text-anchor="middle" font-family="Averta CY, Arial, sans-serif" font-size="32" fill="${textHex}">${formattedMedName}</text>
        ${bottomTextSvg}
    `;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${newWidth}" height="${newHeight}" viewBox="0 0 ${newWidth} ${newHeight}">
        ${backgroundSvg}
        ${textSvg}
    </svg>`;
}

async function main() {
    // --- CLI Setup using Commander ---
    const program = new Command();
    
    program
        .name('mkMediLabels')
        .description('Generates styled SVG syringe labels based on ISO color standards using LLM categorization.')
        .version('1.0.0')
        .option('-c, --classes <path>', 'Path to classes.json', 'classes.json')
        .option('-g, --german <path>', 'Path to tallmanGer.csv', 'tallmanGer.csv')
        .option('-e, --english <path>', 'Path to tallmanEngl.csv', 'tallmanEngl.csv')
        .option('-i, --input <path>', 'Path to the input text file (comma separated)', 'input_meds.txt')
        .option('-o, --output <dir>', 'Directory to save the generated SVG files', './labels')
        .option('-a, --auto-dosage', 'Automatically fetch absolute adult IV bolus dosages (e.g., 5 mg) via API', false)
        .option('-C, --concentration', 'If auto-dosage is enabled, fetch concentration (e.g., 10 mg/ml). If disabled, infers concentration unit.', false)
        .option('-s, --scale <number>', 'Scale multiplier for text relative to label size. Larger means smaller padding (default: 1.0)', '1.0')
        .option('-k, --api-key <string>', 'Gemini API key as plaintext')
        .option('-K, --api-key-file <path>', 'Path to file containing Gemini API key');

    program.parse(process.argv);
    const options = program.opts();

    // --- Core Inversion Math ---
    let scaleInputValueStr = options.scale;
    if (typeof options.scale === 'boolean') scaleInputValueStr = '1.0'; // Default, commander parser quirk
    const scaleInputValue = parseFloat(scaleInputValueStr);
    if (isNaN(scaleInputValue) || scaleInputValue <= 0) {
        console.error("Error: --scale must be a number greater than 0.");
        process.exit(1);
    }
    // Invert the scale so larger S -> smaller padding (approaching 0 at infinity)
    const paddingScale = 1 / scaleInputValue;

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
        console.error("Error: GEMINI_API_KEY environment variable is missing, and no --api-key or --api-key-file provided.");
        process.exit(1);
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

    if (!fs.existsSync(options.classes)) {
        console.error(`Error: Missing classes definition file at ${options.classes}`);
        process.exit(1);
    }
    const classesData: Record<string, MedClass> = JSON.parse(fs.readFileSync(options.classes, 'utf-8'));
    const validTargetKeys = Object.keys(classesData).filter(k => !['adrenaline', 'suxamethonium', 'protamine'].includes(k));
    
    const tallmanMap = new Map<string, string>();
    const englishMap = parseTallmanCSV(options.english);
    for (const[key, val] of englishMap.entries()) { tallmanMap.set(key, val); }
    const germanMap = parseTallmanCSV(options.german);
    for (const [key, val] of germanMap.entries()) { tallmanMap.set(key, val); }

    console.log(`Loaded ${tallmanMap.size} unique Tall Man lettering entries.`);
    console.log(`Auto-dosage resolution: ${options.autoDosage ? "ON" : "OFF"}`);
    console.log(`Resolution Mode: ${options.concentration ? "Concentration (e.g., mg/ml)" : "Absolute Bolus Dose (e.g., mg)"}`);
    console.log(`Text Scale: ${scaleInputValue} (Padding Multiplier: ${paddingScale.toFixed(2)})`);

    const inputMeds = parseInputMeds(options.input);
    if (inputMeds.length === 0) {
        console.log(`No medications found in ${options.input}`);
        return;
    }

    if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
    }

    for (const inputObj of inputMeds) {
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
        } else if (!inputObj.userClass && searchKey === "protamine") {
            classPromise = Promise.resolve("protamine");
        } else {
            let classPrompt = "";
            if (inputObj.userClass) {
                classPrompt = `
                You are a strict data formatting assistant.
                Provided Semantic Category: "${inputObj.userClass}"
                Valid Target Keys: ${JSON.stringify(validTargetKeys)}

                Instructions:
                1. Map the Provided Semantic Category to the closest match from the Valid Target Keys.
                2. "analgetikum", "analgesic", "painkiller", MUST map to "Opioids".
                3. Return ONLY the exact string from the Valid Target Keys. No explanations.
                `;
            } else {
                classPrompt = `
                You are a strict pharmaceutical categorization assistant.
                Medication Name: "${tallmanName}"
                Valid Target Keys: ${JSON.stringify(validTargetKeys)}

                Instructions:
                1. Categorize into the Valid Target Keys based on standard anesthesia/critical care syringe label colors.
                2. Return ONLY the exact string from the Valid Target Keys.
                3. If the drug does not fit these categories, output "Other".
                `;
            }

            classPromise = model.generateContent(classPrompt).then(res => {
                const text = res.response.text().trim();
                return validTargetKeys.includes(text) ? text : "Other";
            }).catch(err => {
                console.error(`❌ API Error categorizing ${tallmanName}:`, err);
                return "Other";
            });
        }

        // 2. Setup Dosage Promise
        let dosagePrompt = "";
        
        if (options.autoDosage) {
            if (options.concentration) {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard pre-filled syringe or standard ampule/drawing concentration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the numerical value and unit (e.g., "1 mg/ml", "50 mcg/ml", "1000 IE/ml", "0.5 mg/ml").
                2. Do not include any text, markdown, or explanation.
                3. If there are multiple, provide the single most common adult emergency concentration. DO NOT provide ranges or weight-based doses.
                `;
            } else {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard absolute single-dose for one-time IV bolus administration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the numerical value and unit (e.g., "5 mg", "1 g", "50 mcg", "10 IE").
                2. Do not include any text, markdown, or explanation.
                3. If there are multiple, provide the single most common adult emergency bolus dose. DO NOT provide ranges or weight-based doses.
                `;
            }
        } else {
            // Auto dosage OFF -> Infer ONLY the Unit (no numbers)
            if (options.concentration) {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard unit of concentration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the unit itself (e.g., "mg/ml", "mcg/ml", "IE/ml").
                2. DO NOT include any numbers.
                3. Do not include any text, markdown, or explanation.
                `;
            } else {
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard unit for an absolute single-dose IV bolus of the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the unit itself (e.g., "mg", "mcg", "g", "IE").
                2. DO NOT include any numbers.
                3. Do not include any text, markdown, or explanation.
                `;
            }
        }
        
        dosagePromise = model.generateContent(dosagePrompt).then(res => {
            let text = res.response.text().trim();
            
            if (text.length > 15 || text.includes('\n')) {
                return options.concentration ? "mg/ml" : "mg";
            }
            
            if (!options.autoDosage) {
                text = text.replace(/[0-9.]/g, '').trim();
                if (!text) return options.concentration ? "mg/ml" : "mg";
            }
            
            return text;
        }).catch(err => {
            console.error(`❌ API Error fetching dosage for ${tallmanName}:`, err);
            return options.concentration ? "mg/ml" : "mg";
        });

        // Execute API calls concurrently
        const[resolvedClass, resolvedDosage] = await Promise.all([classPromise, dosagePromise]);
        
        assignedClass = resolvedClass;
        console.log(` > Assigned Class: ${assignedClass}`);
        console.log(` > Discovered Text: ${resolvedDosage}`);

        const classStyle = classesData[assignedClass] || classesData["Other"];
        const svgContent = generateSVG(tallmanName, classStyle, resolvedDosage, options.autoDosage, paddingScale);
        const safeFilename = tallmanName.replace(/[^a-zA-Z0-9]/gi, '_');
        const outputPath = `${options.output}/${safeFilename}.svg`;
        
        fs.writeFileSync(outputPath, svgContent);
        console.log(` > Saved to ${outputPath}`);
    }

    console.log("\nDone!");
}

main();