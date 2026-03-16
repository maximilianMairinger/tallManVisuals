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

function generateSVG(medName: string, medClass: MedClass, dosageText: string): string {
    const width = 300;
    const height = 120;
    
    const bgHex = PANTONE_TO_HEX[medClass.backgroundColor] || '#FFFFFF';
    const textHex = PANTONE_TO_HEX[medClass.textColor] || '#000000';
    const unitTextHex = PANTONE_TO_HEX[medClass.unitTextColor] || '#000000';
    
    let backgroundSvg = '';

    if (medClass.isStriped && medClass.secondaryBackgroundColor) {
        const stripeHex = PANTONE_TO_HEX[medClass.secondaryBackgroundColor] || '#000000';
        backgroundSvg = `
            <defs>
                <pattern id="stripes" width="20" height="20" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="20" stroke="${stripeHex}" stroke-width="15" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#stripes)" rx="10" />
            <rect x="15" y="15" width="270" height="90" fill="#FFFFFF" rx="5" />
        `;
    } 
    else if (medClass.isSplit && medClass.secondaryBackgroundColor) {
        const bottomHex = PANTONE_TO_HEX[medClass.secondaryBackgroundColor] || '#000000';
        backgroundSvg = `
            <rect width="100%" height="100%" fill="${bottomHex}" rx="10" />
            <path d="M 0 10 C 0 4.477 4.477 0 10 0 L 290 0 C 295.523 0 300 4.477 300 10 L 300 55 L 0 55 Z" fill="${bgHex}" />
        `;
    }
    else if (medClass.hasBorder && medClass.borderColor) {
        const borderHex = PANTONE_TO_HEX[medClass.borderColor] || '#000000';
        backgroundSvg = `
            <rect x="4" y="4" width="292" height="112" fill="${bgHex}" stroke="${borderHex}" stroke-width="8" rx="10" />
        `;
    }
    else {
        backgroundSvg = `
            <rect width="100%" height="100%" fill="${bgHex}" rx="10" />
        `;
    }

    const formattedMedName = formatTallmanSVG(medName);
    
    const lineX1 = 30;
    const lineX2 = 140;
    const textX = 150; 
    let textSvg = '';

    if (medClass.isSplit) {
        textSvg = `
            <text x="50%" y="30" dominant-baseline="middle" text-anchor="middle" font-family="Averta CY, Arial, sans-serif" font-size="32" fill="${textHex}">${formattedMedName}</text>
            <line x1="${lineX1}" y1="95" x2="${lineX2}" y2="95" stroke="${unitTextHex}" stroke-width="2.5" stroke-dasharray="4,8" stroke-linecap="round" />
            <text x="${textX}" y="95" dominant-baseline="middle" text-anchor="start" font-family="Averta CY, Arial, sans-serif" font-weight="bold" font-size="20" fill="${unitTextHex}">${dosageText}</text>
        `;
    } else {
        textSvg = `
            <text x="50%" y="45" dominant-baseline="middle" text-anchor="middle" font-family="Averta CY, Arial, sans-serif" font-size="32" fill="${textHex}">${formattedMedName}</text>
            <line x1="${lineX1}" y1="95" x2="${lineX2}" y2="95" stroke="${unitTextHex}" stroke-width="2.5" stroke-dasharray="4,8" stroke-linecap="round" />
            <text x="${textX}" y="95" dominant-baseline="middle" text-anchor="start" font-family="Averta CY, Arial, sans-serif" font-weight="bold" font-size="20" fill="${unitTextHex}">${dosageText}</text>
        `;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
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
        .option('-C, --concentration', 'If auto-dosage is enabled, fetch concentration (e.g., 10 mg/ml) instead of absolute dose', false);

    program.parse(process.argv);
    const options = program.opts();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("Error: GEMINI_API_KEY environment variable is missing.");
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
    if (options.autoDosage) {
        console.log(`Resolution Mode: ${options.concentration ? "Concentration (e.g., mg/ml)" : "Absolute Bolus Dose (e.g., mg)"}`);
    }

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
        if (options.autoDosage) {
            let dosagePrompt = "";
            
            if (options.concentration) {
                // Legacy behavior: Concentration
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard pre-filled syringe or standard ampule/drawing concentration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the numerical value and unit (e.g., "1 mg/ml", "50 mcg/ml", "1000 IE/ml", "0.5 mg/ml").
                2. Do not include any text, markdown, or explanation.
                3. If there are multiple, provide the single most common adult emergency concentration.
                `;
            } else {
                // New default behavior: Absolute Bolus Dose
                dosagePrompt = `
                You are an expert emergency physician/paramedic operating in Austria/Europe.
                What is the standard absolute single-dose for one-time IV bolus administration for the emergency medication "${tallmanName}"?
                Instructions:
                1. Respond ONLY with the numerical value and unit (e.g., "5 mg", "1 g", "50 mcg", "10 IE").
                2. Do not include any text, markdown, or explanation.
                3. If there are multiple, provide the single most common adult emergency bolus dose.
                `;
            }
            
            dosagePromise = model.generateContent(dosagePrompt).then(res => {
                let text = res.response.text().trim();
                if (text.length > 15 || text.includes('\n')) {
                    return options.concentration ? "mg/ml" : "mg";
                }
                return text;
            }).catch(err => {
                console.error(`❌ API Error fetching dosage for ${tallmanName}:`, err);
                return options.concentration ? "mg/ml" : "mg";
            });
        } else {
            // Default placeholder text
            dosagePromise = Promise.resolve(options.concentration ? "mg/ml" : "mg");
        }

        // Execute API calls concurrently
        const [resolvedClass, resolvedDosage] = await Promise.all([classPromise, dosagePromise]);
        
        assignedClass = resolvedClass;
        console.log(` > Assigned Class: ${assignedClass}`);
        if (options.autoDosage) console.log(` > Discovered Dosage: ${resolvedDosage}`);

        const classStyle = classesData[assignedClass] || classesData["Other"];
        const svgContent = generateSVG(tallmanName, classStyle, resolvedDosage);
        const safeFilename = tallmanName.replace(/[^a-zA-Z0-9]/gi, '_');
        const outputPath = `${options.output}/${safeFilename}.svg`;
        
        fs.writeFileSync(outputPath, svgContent);
        console.log(` > Saved to ${outputPath}`);
    }

    console.log("\nDone!");
}

main();