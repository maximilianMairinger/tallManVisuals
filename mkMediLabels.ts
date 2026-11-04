#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { Command, Option } from 'commander';
import { AVERTA_CY_WIDTHS, AVERTA_CY_FALLBACK_WIDTH } from './fontMetrics.ts';

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

// Medications with their own dedicated label class, keyed by every accepted (lowercase) name, German and English.
const SPECIAL_CLASS_NAMES = new Map<string, string>([
    ["adrenaline", "adrenaline"],
    ["adrenalin", "adrenaline"],
    ["epinephrine", "adrenaline"],
    ["epinephrin", "adrenaline"],
    ["suxamethonium", "suxamethonium"],
    ["succinylcholine", "suxamethonium"],
    ["succinylcholin", "suxamethonium"],
    ["protamine", "protamine"],
    ["protamin", "protamine"]
]);

interface MedClass {
    backgroundColor: string;
    secondaryBackgroundColor?: string;
    textColor: string;
    unitTextColor: string;
    isStriped: boolean;
    isSplit: boolean;
    hasBorder: boolean;
    borderColor?: string;
    hasNameUnderline?: boolean;
}

export interface InputMed {
    name: string;
    userClass?: string;
}

// --- Helper Functions ---

// The bundled data files ship next to this script, so resolve them from here instead of the CWD (bunx runs from anywhere).
// Compiled binaries have no real script dir, so they fall back to the CWD.
function defaultDataPath(fileName: string): string {
    const bundledPath = path.join(path.dirname(fileURLToPath(import.meta.url)), fileName);
    return fs.existsSync(bundledPath) ? bundledPath : fileName;
}

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

// --- Color Helpers (OKLCH, a perceptual color space, so a shade keeps its hue and looks evenly darker across classes) ---

function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexToOklch(hex: string): { L: number; C: number; h: number } {
    const [r, g, b] = [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return { L, C: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

// Returns linear sRGB channels, which may fall outside [0, 1] when the color is out of gamut
function oklchToLinearRgb(L: number, C: number, h: number): number[] {
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
}

// Darker shade of a color: scales OKLCH lightness and chroma by the same factor and keeps the hue.
// 0.72 reproduces a hand-picked border for Process yellow C (#FFE900 -> #A49615, hand-picked was #A59815).
function shadeColor(hex: string, factor = 0.72): string {
    const { L, C, h } = hexToOklch(hex);
    let chroma = C * factor;
    let rgb = oklchToLinearRgb(L * factor, chroma, h);
    // Pull chroma in until the shade fits into sRGB
    while (rgb.some(c => c < 0 || c > 1) && chroma > 0) {
        chroma = Math.max(0, chroma - 0.005);
        rgb = oklchToLinearRgb(L * factor, chroma, h);
    }
    return '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}

interface TextSegment {
    text: string;
    bold: boolean;
}

function tallmanSegments(medName: string): TextSegment[] {
    // Tall Man segments are runs of capitals. At the start of a word a single capital is just normal capitalization
    // (the "A" in "AmLODIPin"), so there it takes 2+; inside a word even a single capital counts (e.g. "abCdef").
    // The split keeps the matched segments at the odd indices.
    const parts = medName.split(/((?<!\p{L})[A-ZÄÖÜ]{2,}|(?<=\p{L})[A-ZÄÖÜ]+)/u);
    return parts.map((text, i) => ({ text, bold: i % 2 === 1 })).filter(s => s.text);
}

function formatTallmanSVG(medName: string): string {
    // Figma BUG workaround: If the text starts directly with a bold tspan, Figma forces the whole block to be bold.
    // Injecting an invisible normal zero-width-space tspan perfectly roots Figma's initial text node state.
    const figmaBugFixPrefix = `<tspan font-weight="normal">&#8203;</tspan>`;

    const formed = tallmanSegments(medName)
        .map(s => `<tspan font-weight="${s.bold ? 'bold' : 'normal'}">${s.text}</tspan>`)
        .join('');

    return figmaBugFixPrefix + formed;
}

// Rendered width in px of the segments in Averta CY at the given font size (kerning ignored)
function measureText(segments: TextSegment[], fontSize: number): number {
    let em = 0;
    for (const { text, bold } of segments) {
        const widths = AVERTA_CY_WIDTHS[bold ? 'bold' : 'regular'];
        for (const char of text) em += widths[char] ?? AVERTA_CY_FALLBACK_WIDTH;
    }
    return em * fontSize;
}

// Ways to break a name into two lines: at a space (dropped) or after a hyphen (kept on the first line)
function twoLineSplits(name: string): [string, string][] {
    const splits: [string, string][] = [];
    for (let i = 1; i < name.length - 1; i++) {
        if (name[i] === ' ') splits.push([name.slice(0, i).trim(), name.slice(i + 1).trim()]);
        else if (name[i] === '-') splits.push([name.slice(0, i + 1).trim(), name.slice(i + 1).trim()]);
    }
    return splits.filter(([first, second]) => first && second);
}

// Below this font scale a name that can be broken onto two lines is wrapped instead of shrunk further
const WRAP_BELOW_SCALE = 0.65;
// Font metrics as a fraction of the font size, matching the 24/8 ascent/descent used for the 32px name
const NAME_ASCENT = 0.75;
const NAME_DESCENT = 0.25;
const NAME_LINE_GAP = 1.05; // baseline to baseline for two-line names

function generateSVG(medName: string, medClass: MedClass, dosageText: string, isAutoDosage: boolean, paddingScale: number, sizeScale: number, tonalBorder: boolean): string {
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
    // How far stripes or a border reach into the label from the sides and from the top; text must stay inside
    let frameInsetX = 0;
    let frameInsetTop = 0;

    if (medClass.isStriped && medClass.secondaryBackgroundColor) {
        const stripeHex = PANTONE_TO_HEX[medClass.secondaryBackgroundColor] || '#000000';
        // ISO 26825:2020: the stripes each side of the drug name are at least 15% of the label length.
        // As in the ISO examples, a thin striped band runs along the top and the bottom stays open.
        const sideStripeW = 0.15 * newWidth;
        const topBandH = 15 * paddingScale * sizeScale;
        frameInsetX = sideStripeW;
        frameInsetTop = topBandH;
        backgroundSvg = `
            <defs>
                <pattern id="stripes" width="${20 * sizeScale}" height="${20 * sizeScale}" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="${20 * sizeScale}" stroke="${stripeHex}" stroke-width="${15 * sizeScale}" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#FFFFFF" rx="${rx}" />
            <rect width="100%" height="100%" fill="url(#stripes)" rx="${rx}" />
            <rect x="${sideStripeW}" y="${topBandH}" width="${newWidth - 2 * sideStripeW}" height="${newHeight - topBandH + rx}" fill="#FFFFFF" rx="${rx * 0.5}" />
        `; // The inner rect runs past the bottom edge so only its top corners are rounded
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
    else if ((medClass.hasBorder && medClass.borderColor) || tonalBorder) {
        // Classes with their own border keep it; with tonalBorder (not part of ISO 26825), solid labels get a darker shade of their background
        const borderHex = medClass.hasBorder && medClass.borderColor
            ? PANTONE_TO_HEX[medClass.borderColor] || '#000000'
            : shadeColor(bgHex);
        const borderInset = 4 * paddingScale * sizeScale;
        const borderStroke = 8 * paddingScale * sizeScale;
        frameInsetX = frameInsetTop = borderInset + borderStroke / 2;
        backgroundSvg = `
            <rect x="${borderInset}" y="${borderInset}" width="${newWidth - 2*borderInset}" height="${newHeight - 2*borderInset}" fill="${bgHex}" stroke="${borderHex}" stroke-width="${borderStroke}" rx="${rx}" />
        `;
    }
    else {
        backgroundSvg = `
            <rect width="100%" height="100%" fill="${bgHex}" rx="${rx}" />
        `;
    }

    // --- Text Fitting (widths measured with the Averta CY metrics) ---
    const textMaxWidth = newWidth - 2 * (frameInsetX + 10 * paddingScale * sizeScale);

    // Name: shrink to fit on one line; if that gets too small and the name has a space or hyphen, wrap it onto two lines
    const nameFontSize = 32 * sizeScale;
    const oneLineScale = Math.min(1, textMaxWidth / measureText(tallmanSegments(medName), nameFontSize));

    // Two lines must stay between the frame and the dosage text (or the split line on split labels)
    const nameTopLimit = frameInsetTop + 4 * sizeScale;
    const nameBottomLimit = (medClass.isSplit ? splitLineY : bottomY - text2Ascent) - 4 * sizeScale;
    const nameAreaH = nameBottomLimit - nameTopLimit;
    const twoLineHeightEm = NAME_ASCENT + NAME_LINE_GAP + NAME_DESCENT;

    let twoLines: { lines: [string, string]; scale: number; widest: number } | undefined;
    if (oneLineScale < WRAP_BELOW_SCALE) {
        for (const lines of twoLineSplits(medName)) {
            const widest = Math.max(...lines.map(line => measureText(tallmanSegments(line), nameFontSize)));
            const scale = Math.min(1, textMaxWidth / widest, nameAreaH / (twoLineHeightEm * nameFontSize));
            if (!twoLines || scale > twoLines.scale) twoLines = { lines, scale, widest };
        }
    }

    const nameText = (text: string, y: number, fontSize: number) =>
        `<text x="50%" y="${y}" text-anchor="middle" font-family="Averta CY" font-size="${fontSize}" fill="${textHex}">${formatTallmanSVG(text)}</text>`;

    let nameSvg: string;
    let nameWidth: number; // rendered width of the (widest line of the) name, which is centered on the label
    let nameBottom: number; // lowest point of the name's descenders
    if (twoLines && twoLines.scale > oneLineScale) {
        const fontSize = nameFontSize * twoLines.scale;
        const blockTop = nameTopLimit + (nameAreaH - twoLineHeightEm * fontSize) / 2;
        const firstBaseline = blockTop + NAME_ASCENT * fontSize;
        const secondBaseline = firstBaseline + NAME_LINE_GAP * fontSize;
        nameSvg = nameText(twoLines.lines[0], firstBaseline, fontSize) + '\n        '
            + nameText(twoLines.lines[1], secondBaseline, fontSize);
        nameWidth = twoLines.widest * twoLines.scale;
        nameBottom = secondBaseline + NAME_DESCENT * fontSize;
    } else {
        // Shift the baseline up as the font shrinks so the name stays vertically centered where it was
        const fontSize = nameFontSize * oneLineScale;
        const baseline = topTextY - (NAME_ASCENT - NAME_DESCENT) / 2 * (nameFontSize - fontSize);
        nameSvg = nameText(medName, baseline, fontSize);
        nameWidth = measureText(tallmanSegments(medName), fontSize);
        nameBottom = baseline + NAME_DESCENT * fontSize;
    }
    const nameLeft = (newWidth - nameWidth) / 2;
    const nameRight = nameLeft + nameWidth;

    // ISO 26825:2020 marks muscle relaxant reversal drugs with a black line beneath the drug name, halfway down to the dosage
    if (medClass.hasNameUnderline) {
        const underlineY = (nameBottom + bottomY - text2Ascent) / 2;
        nameSvg += `\n        <line x1="${nameLeft}" y1="${underlineY}" x2="${nameRight}" y2="${underlineY}" stroke="${textHex}" stroke-width="${1.5 * sizeScale}" />`;
    }

    // Dosage: bold amount + normal rest, shrunk the same way if it is too wide (next to the write-in line when there is one)
    const dosageParts = dosageText.split(' ');
    const dosageSegments: TextSegment[] = dosageParts.length > 1
        ? [{ text: dosageParts[0], bold: true }, { text: ' ' + dosageParts.slice(1).join(' '), bold: false }]
        : [{ text: dosageText, bold: true }];
    const minLineLen = 90 * paddingScale * sizeScale; // the write-in line never gets shorter than this
    const gap = 8 * paddingScale * sizeScale;
    const dosageMaxWidth = isAutoDosage ? textMaxWidth : textMaxWidth - minLineLen - gap;
    const dosageFontSize = 22 * sizeScale * Math.min(1, dosageMaxWidth / measureText(dosageSegments, 22 * sizeScale));
    const dosageWidth = measureText(dosageSegments, dosageFontSize);

    let bottomTextSvg = '';

    if (isAutoDosage) {
        // Auto-Dosage ON -> Centered text only, NO line
        const parts = dosageParts;
        if (parts.length > 1) {
            bottomTextSvg = `<text x="50%" y="${bottomY}" text-anchor="middle" font-family="Averta CY" font-size="${dosageFontSize}" fill="${unitTextHex}"><tspan font-weight="normal">&#8203;</tspan><tspan font-weight="bold">${parts[0]}</tspan><tspan font-weight="normal">&#160;${parts.slice(1).join(' ')}</tspan></text>`;
        } else {
            bottomTextSvg = `<text x="50%" y="${bottomY}" text-anchor="middle" font-family="Averta CY" font-weight="bold" font-size="${dosageFontSize}" fill="${unitTextHex}">${dosageText}</text>`;
        }
    } else {
        // Auto-Dosage OFF -> Write-in line with the unit pinned to the right, as in ISO 26825 ("........ mg/ml")
        const textLeft = (newWidth - textMaxWidth) / 2;
        const textRight = newWidth - textLeft;
        let textX = textRight;
        let lineX1 = textLeft;
        if (medClass.isStriped) {
            // Antagonists: the unit lines up with the right edge of the drug name, and the line starts at its left edge,
            // stretched (within the white area) if that would make the line shorter than minLineLen
            textX = Math.min(textRight, Math.max(nameRight, textLeft + minLineLen + gap + dosageWidth));
            lineX1 = Math.max(textLeft, Math.min(nameLeft, textX - dosageWidth - gap - minLineLen));
        }
        const lineX2 = textX - dosageWidth - gap;

        const parts = dosageParts;
        if (parts.length > 1) {
            bottomTextSvg = `
                <line x1="${lineX1}" y1="${bottomY}" x2="${lineX2}" y2="${bottomY}" stroke="${unitTextHex}" stroke-width="${2.5 * sizeScale}" stroke-dasharray="${4 * sizeScale},${8 * sizeScale}" stroke-linecap="round" />
                <text x="${textX}" y="${bottomY}" text-anchor="end" font-family="Averta CY" font-size="${dosageFontSize}" fill="${unitTextHex}"><tspan font-weight="normal">&#8203;</tspan><tspan font-weight="bold">${parts[0]}</tspan><tspan font-weight="normal">&#160;${parts.slice(1).join(' ')}</tspan></text>
            `;
        } else {
            bottomTextSvg = `
                <line x1="${lineX1}" y1="${bottomY}" x2="${lineX2}" y2="${bottomY}" stroke="${unitTextHex}" stroke-width="${2.5 * sizeScale}" stroke-dasharray="${4 * sizeScale},${8 * sizeScale}" stroke-linecap="round" />
                <text x="${textX}" y="${bottomY}" text-anchor="end" font-family="Averta CY" font-weight="bold" font-size="${dosageFontSize}" fill="${unitTextHex}">${dosageText}</text>
            `;
        }
    }

    const textSvg = `
        ${nameSvg}
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
    tonalBorder?: boolean;
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

    const classesPath = options.classesPath || defaultDataPath('classes.json');
    const germanPath = options.germanPath || defaultDataPath('tallmanGer.csv');
    const englishPath = options.englishPath || defaultDataPath('tallmanEngl.csv');
    const languagePriority = options.languagePriority || 'german';
    const outputDir = options.outputDir || './labels';
    const autoDosage = options.autoDosage || false;
    // ISO 26825 labels show a concentration (mg/ml); an absolute bolus dose (mg) is opt-in
    const concentration = options.concentration ?? true;
    const route = options.route || false;
    const tonalBorder = options.tonalBorder || false;
    const modelName = options.modelName || 'gemini-3.8-flash';


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
    const specialClasses = new Set(SPECIAL_CLASS_NAMES.values());
    const validTargetKeys = Object.keys(classesData).filter(k => !specialClasses.has(k));
    
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
    console.log(`Tonal border: ${tonalBorder ? "ON (not part of ISO 26825)" : "OFF"}`);

    if (options.medications.length === 0) {
        console.log(`No medications provided.`);
        return;
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const failedMeds: string[] = [];
    const promises = options.medications.map(async (inputObj) => {
        const rawName = inputObj.name;
        const searchKey = rawName.toLowerCase();
        const tallmanName = tallmanMap.get(searchKey) || rawName;
        
        console.log(`\nProcessing: ${tallmanName} (Original input: ${rawName})`);

        let assignedClass = "";
        let classPromise: Promise<string>;
        let dosagePromise: Promise<string>;

        // 1. Setup Class Promise
        // A user class that names a class in classes.json is forced as-is; anything else is only a hint for the LLM.
        const forcedClass = inputObj.userClass
            ? Object.keys(classesData).find(k => k.toLowerCase() === inputObj.userClass!.toLowerCase())
            : undefined;
        const specialClass = SPECIAL_CLASS_NAMES.get(searchKey);

        if (forcedClass) {
            console.log(` > User forced class: ${forcedClass}`);
            classPromise = Promise.resolve(forcedClass);
        } else if (!inputObj.userClass && specialClass) {
            classPromise = Promise.resolve(specialClass);
        } else {
            let userClassNote = "";
            if (inputObj.userClass) {
                console.log(` > User suggested class (not in ${classesPath}, passed to the AI as a hint): ${inputObj.userClass}`);
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
                throw err;
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
                // Strip whole numbers (5, 0.5, 1.000) but keep the dots in routes like "i.v."
                text = text.replace(/\d*[.,]?\d+/g, '').trim();
                if (!text) return concentration ? "mg/ml" : "mg";
            }
            
            return text;
        }).catch(err => {
            console.error(`❌ API Error fetching dosage for ${tallmanName}:`, err);
            throw err;
        });

        // Execute API calls concurrently. If either fails, write no label rather than one with a guessed class or unit.
        let resolvedClass: string, resolvedDosage: string;
        try {
            [resolvedClass, resolvedDosage] = await Promise.all([classPromise, dosagePromise]);
        } catch {
            console.error(` > Skipped ${tallmanName}: no label written because the API request failed.`);
            failedMeds.push(tallmanName);
            return;
        }

        assignedClass = resolvedClass;
        console.log(` > Assigned Class: ${assignedClass}`);
        console.log(` > Discovered Text: ${resolvedDosage}`);

        const classStyle = classesData[assignedClass] || classesData["Other"];
        const svgContent = generateSVG(tallmanName, classStyle, resolvedDosage, autoDosage, paddingScale, sizeScale, tonalBorder);
        const safeFilename = tallmanName.replace(/[^a-zA-Z0-9]/gi, '_');
        const outputPath = `${outputDir}/${safeFilename}.svg`;
        
        fs.writeFileSync(outputPath, svgContent);
        console.log(` > Saved to ${outputPath}`);
    });

    await Promise.all(promises);

    if (failedMeds.length > 0) {
        throw new Error(`❌ No label was written for ${failedMeds.length} medication(s) because the Gemini API request failed (check your API key and rate limits): ${failedMeds.join(', ')}`);
    }

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
  bun run mkMediLabels.ts Adrenalin Suxamethonium "Propofol (Induction drugs)"`)
        .version('1.0.0')
        .option('-c, --classes <path>', 'Path to classes.json (default: the bundled classes.json)')
        .option('-g, --german <path>', 'Path to tallmanGer.csv (default: the bundled tallmanGer.csv)')
        .option('-e, --english <path>', 'Path to tallmanEngl.csv (default: the bundled tallmanEngl.csv)')
        .option('-l, --language-priority <german|english>', 'Which language takes precedence for Tall Man lettering matching', 'german')        
        .option('-f, --medications-file <path>', 'Path to the input text file (comma separated)', 'input_meds.txt')
        .option('-m, --medications <string>', 'Direct input of medications as a comma-separated string')
        .option('-o, --output <dir>', 'Directory to save the generated SVG files', './labels')
        .option('-a, --auto-dosage', 'Automatically fetch absolute adult IV bolus dosages (e.g., 5 mg) via API', false)
        .option('-B, --bolus', 'Use an absolute bolus dose (e.g. 5 mg) instead of the ISO concentration (e.g. 5 mg/ml)', false)
        // Concentration is the default now; -C is still accepted so older commands keep working
        .addOption(new Option('-C, --concentration').hideHelp())
        .option('-r, --route', 'Include administration route (e.g. i.v., inh.) next to the dosage/concentration', false)
        .option('-s, --scale <number>', 'Scale multiplier for text relative to label size. Larger means smaller padding (default: 1.0)', '1.0')
        .option('-S, --size-scale <number>', 'Scale multiplier for the entire SVG size linearly (default: 1.0)', '1.0')
        .option('-b, --tonal-border', 'Give solid-color labels a border in a darker shade of their background (not part of ISO 26825)', false)
        .option('--model <string>', 'Gemini API model to use', 'gemini-3.8-flash')
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
            concentration: !options.bolus,
            route: options.route,
            scale: options.scale,
            sizeScale: options.sizeScale,
            modelName: options.model,
            tonalBorder: options.tonalBorder
        });
    } catch (e: any) {
        console.error(e.message);
        process.exit(1);
    }
}

if (require.main === module || (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('mkMediLabels.ts'))) {
    main();
}