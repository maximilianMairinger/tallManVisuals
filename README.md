# Tall Man Medis - Syringe Label Generator

A robust CLI tool and library for generating styled, ISO-compliant (ISO 26825 / DIVI) SVG syringe labels for medical use in critical care and anesthesia. 

It leverages the Gemini Pro API to automatically categorize medications into their appropriate standard color classes, predict standardized emergency bolus dosages vs. concentrations, and applies Tall Man lettering for increased safety. 

*Note: This tool is heavily tailored toward **German** standards (DIVI) first and **English** second.* This can be changes via the `--language-priority` option, see below for more.

## Further Reading & Standards
- The official ISO for the colors: [ISO 26825:2020 - User-applied labels for syringes containing drugs used during anaesthesia](https://www.iso.org/standard/74033.html). I took the colors from [anaesthetists.org](https://anaesthetists.org/Portals/0/PDFs/Guidelines%20PDFs/Syringe%20labelling%202022%20v1.1.pdf?ver=2022-10-26-140938-370)
- [ISMP Tall Man Lettering Guide](https://online.ecri.org/hubfs/ISMP/Resources/ISMP_Look-Alike_Tallman_Letters.pdf)
- [Proposal of a Tall Man Letter list for German-speaking countries](https://pmc.ncbi.nlm.nih.gov/articles/PMC8275545/)

## Features
- **ISO Color Standards**: Automatically applies the correct background, text, and stripe colors based on standard anesthesia/critical care classifications.
- **LLM-Powered Categorization**: Uses the Gemini API to intelligently classify a drug based on standard medical guidelines.
- **Intelligent Auto-Dosage**: Predicts both the standard unit (e.g., `mg`/`mcg`) and the standard absolute IV bolus dose or concentration structure based on european (specifically German/Austrian) emergency medicine standards.
- **Tall Man Lettering**: Uses internal libraries (German prioritized over English fallback) to safely format look-alike, sound-alike drug names (e.g., *AmiodarONE*).
- **Proportional SVG Layout**: Output clean, elastic, scalable `.svg` configurations directly.
- **API and CLI Integration**: Fast execution via Bun, or callable as a TypeScript library in other projects.

## Prerequisites
- [Bun](https://bun.sh/) (JavaScript runtime)
- A [Gemini API Key](https://aistudio.google.com/app/apikey).

## Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Set your API Key:
   ```bash
   export GEMINI_API_KEY="your-api-key-here"
   ```
   *(Alternatively, you can pass it via `--api-key` or `--api-key-file`)*

---

## Usage (CLI)

You can provide medications via a text file, a comma-separated string, or directly as positional arguments. Note: you can optionally append an explicit classification in parentheses!

**1. Direct arguments (Positional):**
```bash
bun run mkMediLabels.ts Adrenalin Fentanyl "Propofol (Hypnotics)"
```

**2. Using a string flag:**
```bash
bun run mkMediLabels.ts -m "Amiodaron, Ketamin, Midazolam"
```

**3. Using an input file:**
```bash
bun run mkMediLabels.ts -f input_meds.txt
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --medications-file <path>` | Path to the text/csv input file | `input_meds.txt` |
| `-m, --medications <string>` | Direct input as a comma-separated string | |
| `-l, --language-priority <german\|english>` | Base language to prioritize for Tall Man Lettering | `german` |
| `-o, --output <dir>` | Directory to save generated SVGs | `./labels` |
| `-a, --auto-dosage` | Fetch numerical dosages (e.g., `5 mg`) via API | `false` |
| `-C, --concentration` | Fetch concentration (e.g., `10 mg/ml`). (If `false`, uses absolute dose instead) | `false` |
| `-s, --scale <number>` | Scale multiplier for text padding. `1.0` is default size | `1.0` |
| `-k, --api-key <string>` | Pass the Gemini API key as plaintext | |
| `-K, --api-key-file <path>`| Path to file containing the Gemini API key | |

Example with full layout options:
```bash
bun run mkMediLabels.ts -a -C -s 1.2 "Thiopental"
```

---

## Usage (Library)

You can import the core generator directly into any Node/Bun/TypeScript project:

```typescript
import { generateMediLabels } from './mkMediLabels';

await generateMediLabels({
    medications: [
        { name: "Fentanyl" },
        { name: "Propofol", userClass: "Hypnotics" } // Provide a hard "hint" bypassing random guesses
    ],
    apiKey: process.env.GEMINI_API_KEY,
    languagePriority: 'german',
    outputDir: "./custom_labels",
    autoDosage: true,    // Generate text sizes like "5 mg"
    concentration: true, // Use concentration format "10 mg/ml" 
    scale: 1.0           // Normal text size padding
});
```
