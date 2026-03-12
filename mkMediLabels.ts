import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Configuration ---
const FILES = {
    CLASSES_JSON: 'classes.json',     
    TALLMAN_GER_CSV: 'tallmanGer.csv', // German list (Highest priority)
    TALLMAN_ENGL_CSV: 'tallmanEngl.csv', // English list (Fallback)
    INPUT_MEDS: 'input_meds.txt',     
    OUTPUT_DIR: './labels'            
};

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
    medication_class_type: string;
    text_color: string;
    background_color: string;
}

// --- Helper Functions ---

// Robust parser to handle multi-line quotes and commas in the comments column
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
                i++; // Skip escaped quote
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
            
            // Skip header and empty lines
            if (currentMed && currentMed.toLowerCase() !== 'medicine') {
                // Remove trailing asterisks (e.g., benzylpenicillin*)
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
    
    // Catch the final line if no trailing newline exists
    if (isFirstField && currentField) currentMed = currentField.trim();
    if (currentMed && currentMed.toLowerCase() !== 'medicine') {
        const cleanMed = currentMed.replace(/\*$/, '');
        map.set(cleanMed.toLowerCase(), cleanMed);
    }

    return map;
}

function parseInputMeds(filePath: string): string[] {
    if (!fs.existsSync(filePath)) return[];
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split(',').map(m => m.trim()).filter(m => m.length > 0);
}

function extractPrimaryColor(bgDescription: string): string {
    for (const color of Object.keys(PANTONE_TO_HEX)) {
        if (bgDescription.includes(color) && color !== 'White' && color !== 'Black') {
            return PANTONE_TO_HEX[color];
        }
    }
    return bgDescription.includes('Black') ? '#000000' : '#FFFFFF';
}

// Formats medicine name: ALL CAPS becomes bold, everything else is normal
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

function generateSVG(medName: string, medClass: MedClass): string {
    const width = 300;
    const height = 120;
    const bgDesc = medClass.background_color;
    
    let backgroundSvg = '';
    let textFill = medClass.text_color.includes('White') ? '#FFFFFF' : '#000000';

    if (bgDesc.includes('diagonal stripes')) {
        const stripeColor = extractPrimaryColor(bgDesc);
        backgroundSvg = `
            <defs>
                <pattern id="stripes" width="20" height="20" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="20" stroke="${stripeColor}" stroke-width="15" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#stripes)" rx="10" />
            <rect x="30" y="10" width="240" height="100" fill="#FFFFFF" rx="5" />
        `;
        textFill = '#000000';
    } 
    else if (bgDesc.includes('top half') && bgDesc.includes('bottom half')) {
        const bottomColor = extractPrimaryColor(bgDesc);
        backgroundSvg = `
            <rect width="100%" height="50%" fill="#000000" rx="10" />
            <rect y="40" width="100%" height="20" fill="#000000" /> 
            <rect y="50" width="100%" height="50%" fill="${bottomColor}" />
            <rect y="50" width="100%" height="70" fill="${bottomColor}" rx="10" />
            <rect y="50" width="100%" height="20" fill="${bottomColor}" /> 
        `;
    }
    else if (bgDesc.includes('solid Black border')) {
        backgroundSvg = `
            <rect width="100%" height="100%" fill="#FFFFFF" stroke="#000000" stroke-width="10" rx="10" />
        `;
    }
    else {
        const solidColor = PANTONE_TO_HEX[bgDesc] || '#FFFFFF';
        backgroundSvg = `
            <rect width="100%" height="100%" fill="${solidColor}" rx="10" />
        `;
    }

    const formattedMedName = formatTallmanSVG(medName);
    let textSvg = '';
    
    if (bgDesc.includes('top half')) {
        textSvg = `
            <text x="50%" y="40%" dominant-baseline="middle" text-anchor="middle" font-family="Averta CY, Arial, sans-serif" font-size="28" fill="#FFFFFF">${formattedMedName}</text>
            <line x1="40" y1="95" x2="180" y2="95" stroke="#000000" stroke-width="3" stroke-dasharray="4,10" stroke-linecap="round" />
            <text x="270" y="100" text-anchor="end" font-family="Averta CY, Arial, sans-serif" font-weight="bold" font-size="16" fill="#000000">? mg/ml</text>
        `;
    } else {
        textSvg = `
            <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" font-family="Averta CY, Arial, sans-serif" font-size="28" fill="${textFill}">${formattedMedName}</text>
            <line x1="40" y1="95" x2="180" y2="95" stroke="${textFill}" stroke-width="3" stroke-dasharray="4,10" stroke-linecap="round" />
            <text x="270" y="100" text-anchor="end" font-family="Averta CY, Arial, sans-serif" font-weight="bold" font-size="16" fill="${textFill}">? mg/ml</text>
        `;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${backgroundSvg}
        ${textSvg}
    </svg>`;
}

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("Error: GEMINI_API_KEY environment variable is missing.");
        process.exit(1);
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

    if (!fs.existsSync(FILES.CLASSES_JSON)) {
        console.error(`Error: Missing ${FILES.CLASSES_JSON}`);
        return;
    }
    const classesData: Record<string, MedClass> = JSON.parse(fs.readFileSync(FILES.CLASSES_JSON, 'utf-8'));
    const validKeys = Object.keys(classesData);
    
    // --- Load Tallman Maps with Precedence ---
    const tallmanMap = new Map<string, string>();
    
    // 1. Load English (Base layer)
    const englishMap = parseTallmanCSV(FILES.TALLMAN_ENGL_CSV);
    for (const [key, val] of englishMap.entries()) {
        tallmanMap.set(key, val);
    }

    // 2. Load German (Overwrites English on collisions)
    const germanMap = parseTallmanCSV(FILES.TALLMAN_GER_CSV);
    for (const [key, val] of germanMap.entries()) {
        tallmanMap.set(key, val);
    }

    console.log(`Loaded ${tallmanMap.size} unique Tall Man lettering entries.`);

    const inputMeds = parseInputMeds(FILES.INPUT_MEDS);

    if (inputMeds.length === 0) {
        console.log(`No medications found in ${FILES.INPUT_MEDS}`);
        return;
    }

    if (!fs.existsSync(FILES.OUTPUT_DIR)) {
        fs.mkdirSync(FILES.OUTPUT_DIR);
    }

    for (const med of inputMeds) {
        const searchKey = med.toLowerCase();
        const tallmanName = tallmanMap.get(searchKey) || med;
        
        console.log(`Processing: ${tallmanName} (Original input: ${med})`);

        let assignedClass = "";
        if (searchKey === "adrenaline" || searchKey === "epinephrine") {
            assignedClass = "adrenalin";
        } else {
            const prompt = `
            You are a pharmaceutical categorization assistant.
            I have a medication named "${tallmanName}".
            Categorize it into exactly ONE of the following JSON keys: ${JSON.stringify(validKeys)}.
            Return ONLY the string of the key, no markdown, no quotes, no extra text.
            If you are completely unsure, return "Miscellaneous drugs" if it exists, otherwise return the closest match.
            `;

            try {
                const result = await model.generateContent(prompt);
                assignedClass = result.response.text().trim();
                
                if (!validKeys.includes(assignedClass)) {
                    console.warn(`⚠️ Gemini returned an invalid class: "${assignedClass}". Defaulting to Heparin (Misc).`);
                    assignedClass = "Heparin"; 
                }
            } catch (error) {
                console.error(`❌ API Error categorizing ${tallmanName}:`, error);
                continue;
            }
        }

        console.log(` > Assigned Class: ${assignedClass}`);
        const classStyle = classesData[assignedClass];

        const svgContent = generateSVG(tallmanName, classStyle);
        const safeFilename = tallmanName.replace(/[^a-zA-Z0-9]/gi, '_');
        const outputPath = `${FILES.OUTPUT_DIR}/${safeFilename}.svg`;
        
        fs.writeFileSync(outputPath, svgContent);
        console.log(` > Saved to ${outputPath}\n`);
    }

    console.log("Done!");
}

main();