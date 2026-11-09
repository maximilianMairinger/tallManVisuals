# Tall Man Medis - Syringe Label Generator

<p align="center">
  <img src="example/withDoage/LORazepam.svg" width="220" />
  <img src="example/withDoage/Methoxyfluran.svg" width="220" />
  <img src="example/withDoage/Naloxon.svg" width="220" />
  
</p>

A robust CLI tool and library for generating styled, ISO-compliant (ISO 26825 / DIVI) SVG syringe labels for medical use in critical care and anesthesia. 

It leverages the Gemini API to automatically categorize medications into their appropriate standard color classes, predict standardized emergency bolus dosages vs. concentrations, and applies Tall Man lettering for increased safety. 

*Note: This tool is heavily tailored toward **German** standards (DIVI) first and **English** second.* This can be changes via the `--language-priority` option, see below for more.

## Quick Start (via NPM / Bunx)
If you have Bun installed, you don't even need to clone the repository. You can run the tool directly from the NPM registry using `bunx` (Bun's equivalent to `npx`):

```bash
export GEMINI_API_KEY="your-api-key-here"
bunx tall-man-medis -a "Adrenalin"
```

*(Note: Because this is a native TypeScript package, it requires `bunx` instead of `npx` to run successfully!)*

> I think deno would work as well, but havent tested it yet.

## Further Reading & Standards
- The official ISO for the colors: [ISO 26825:2020 - User-applied labels for syringes containing drugs used during anaesthesia](https://www.iso.org/standard/74033.html). I took the colors from [anaesthetists.org](https://anaesthetists.org/Portals/0/PDFs/Guidelines%20PDFs/Syringe%20labelling%202022%20v1.1.pdf?ver=2022-10-26-140938-370). Where this tool deliberately differs, see [ISO 26825 and where we diverge](#iso-26825-and-where-we-diverge).
- [ISMP Tall Man Lettering Guide](https://online.ecri.org/hubfs/ISMP/Resources/ISMP_Look-Alike_Tallman_Letters.pdf)
- [Proposal of a Tall Man Letter list for German-speaking countries](https://pmc.ncbi.nlm.nih.gov/articles/PMC8275545/)

## ISO 26825 and where we diverge
The labels follow ISO 26825:2020 as summarised in the [Association of Anaesthetists' 2022 guidance](https://anaesthetists.org/Portals/0/PDFs/Guidelines%20PDFs/Syringe%20labelling%202022%20v1.1.pdf?ver=2022-10-26-140938-370). Where we differ, it is on purpose and listed here.

**Following the standard**
- Class colours (Pantone) as listed in the guidance.
- Antagonists / drugs of opposite action: white label with diagonal stripes in the colour of the drug class they counteract. The stripes on each side take 15% of the label length, with a thin striped band along the top; the name is shrunk or wrapped to fit between them.
- Adrenaline and suxamethonium: black upper half with white lettering, class colour below.
- Benzodiazepines: white drug name on orange, to tell them apart from the warm red of the muscle relaxants. The dose stays black, which is far easier to read on orange (contrast 8.4:1 vs 2.5:1 for white).
- Muscle relaxant reversal drugs: a black line beneath the drug name, to tell them apart from the other striped labels (especially the orange-striped flumazenil).
- Concentration (`mg/ml`) by default. Write-in labels show a line with the unit at the right (`........ mg/ml`); on antagonist labels the unit lines up with the right edge of the drug name. Pre-filled values (`-a`) are centred.
- Tall Man lettering to differentiate look-alike names.

**Deliberate divergences**
- **No separate heparin label.** Drugs without a class fall into `Other`, which uses heparin's ISO design (white, black border, black text). ISO's "other drugs" (black/white) come without an example.
- **Long names shrink or wrap** onto two lines so they always fit the label.
- **Administration route** (`-r`, e.g. `i.v.`) can be added after the dose. ISO has no route.
- **Absolute bolus doses** (`-B`, e.g. `5 mg`) instead of concentrations are available, but off by default.
- **Darker border** (`-b`), off by default: solid-colour labels get a darker shade of their background as a border; on adrenaline and suxamethonium each half gets its own (the black half stays black).

## Features
- **ISO Color Standards**: Automatically applies the correct background, text, and stripe colors based on standard anesthesia/critical care classifications.
- **LLM-Powered Categorization**: Uses the ultra-fast `@google/genai` API with parallel processing to intelligently classify a drug based on standard medical guidelines.
- **Intelligent Auto-Dosage & Routes**: Predicts both the standard unit (e.g., `mg`/`mcg`) and the standard absolute IV bolus dose, concentration structure, and administration route (e.g., `i.v.`, `inh.`) based on european emergency medicine standards.
- **Tall Man Lettering**: Uses internal libraries (German prioritized over English fallback) to safely format look-alike, sound-alike drug names (e.g., *AmiodarONE*).
- **Proportional SVG Layout**: Outputs clean, elastic, scalable `.svg` configurations directly. Uses explicit geometric math for cross-platform rendering (consistent in Safari, Chrome, and Figma).
- **API and CLI Integration**: Fast execution via Bun, or callable as a TypeScript library in other projects.

## Examples

You can review a large output of generated examples in the `example/withDoage` folder. Here are a few notable outcomes that demonstrate the power of the generation logic:

### 1. Complex Tall Man Translation (DiazePAM)
Correctly breaks out multiple uppercase spans and predicts a standard bolus dose + application route.
```bash
bunx tall-man-medis -a -r -B "diazepam"
```
<img src="example/withDoage/DiazePAM.svg" width="220" />

### 2. Inhalation Route Prediction (Methoxyfluran)
Notice how the API correctly deduces that Methoxyfluran is an inhaled volatile agent, returning `3ml inh.` rather than a systemic mg dose!
```bash
bunx tall-man-medis -a -r -B "Methoxyfluran"
```
<img src="example/withDoage/Methoxyfluran.svg" width="220" />

### 3. Antidotes (Naloxon, Flumazenil, Sugammadex)

- Automatic recognition: the generator detects common antidotes/antagonists (e.g., Naloxon, Flumazenil, Sugammadex) and tags them as "Antidote / Antagonist" to improve classification and labeling semantics.

```bash
bunx tall-man-medis -a -r -B "Naloxon"
```
<img src="example/withDoage/Naloxon.svg" width="220" />

### 4. Explicit Category Overrides (Brackets)
Sometimes the AI might categorize a medication differently than you expect, or an institution has non-standard class assignments. You can **force a specific categorization** by appending the classification in parentheses/brackets next to the drug name!

```bash
bunx tall-man-medis "Ketamin (Induction drugs)" "Adrenalin (Vasopressors)"
```
*(When the bracket text matches a class name from `classes.json` (case-insensitive), this entirely overrides the initial categorization step, meaning zero AI hallucination regarding the ISO standard color group! Any other text, e.g. `(Analgetikum)`, is only passed to the AI as a hint.)*

Available classes: `Anti-emetics`, `Anticholinergic drugs`, `Benzodiazepines`, `Benzodiazepine antagonists`, `Induction drugs`, `Local anaesthetics`, `Muscle relaxants`, `Muscle relaxant reversal drugs`, `Opioids`, `Opioid antagonists`, `Vasopressors`, `Hypotensive drugs`, `Other`, plus the dedicated `adrenaline`, `suxamethonium` and `protamine` labels.

### 5. Write-In / Blank Labels (Standard layout)
By default (without the `-a` flag), the tool generates generic labels with a standardized dotted line for manual dosage inputs.

```bash
bunx tall-man-medis "Adrenalin"
```

<img src="example/withoutDosage/Adrenalin.svg" width="220" />

### 6. Name-Only Labels
With `-n`, the label only shows the medication name, centred, with no dosage, unit or write-in line. Only the class is fetched from the API.

```bash
bunx tall-man-medis -n "Midazolam"
```

## Prerequisites
- [Bun](https://bun.sh/) (JavaScript runtime)
- A [Gemini API Key](https://aistudio.google.com/app/apikey).

## Local Setup (For Development)
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
bunx tall-man-medis Adrenalin Fentanyl "Propofol (Induction drugs)"
```

**2. Using a string flag:**
```bash
bunx tall-man-medis -m "Amiodaron, Ketamin, Midazolam"
```

**3. Using an input file:**
```bash
bunx tall-man-medis -f input_meds.txt
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --medications-file <path>` | Path to the text/csv input file | `input_meds.txt` |
| `-m, --medications <string>` | Direct input as a comma-separated string | |
| `-l, --language-priority <german\|english>` | Base language to prioritize for Tall Man Lettering | `german` |
| `-o, --output <dir>` | Directory to save generated SVGs | `./labels` |
| `-a, --auto-dosage` | Fetch numerical dosages (e.g., `5 mg`) via API | `false` |
| `-B, --bolus` | Use an absolute bolus dose (e.g. `5 mg`) instead of the ISO concentration (e.g. `5 mg/ml`) | `false` |
| `-r, --route` | Include administration route (e.g. `i.v.`, `inh.`) next to the dosage/concentration | `false` |
| `-s, --scale <number>` | Scale multiplier for text padding. `1.0` is default size | `1.0` |
| `-S, --size-scale <number>` | Scale multiplier for the entire SVG size linearly | `1.0` |
| `-b, --tonal-border` | Give solid-color and split labels a border in a darker shade of their background (computed in OKLCH). Not part of ISO 26825 | `false` |
| `-n, --name-only` | Only print the medication name: no dosage, unit or write-in line. Skips the dosage request, and overrides `-a`, `-B` and `-r` | `false` |
| `--model <string>` | Gemini model to use | `gemini-3.8-flash` |
| `-k, --api-key <string>` | Pass the Gemini API key as plaintext | |
| `-K, --api-key-file <path>`| Path to file containing the Gemini API key | |

Example with full layout options:
```bash
bunx tall-man-medis -a -r -S 0.9 -s 1.2 "Thiopental"
```

---

## Usage (Library)

You can import the core generator directly into any Node/Bun/TypeScript project:

```typescript
import { generateMediLabels } from './mkMediLabels';

await generateMediLabels({
    medications: [
        { name: "Fentanyl" },
        { name: "Propofol", userClass: "Induction drugs" } // Forces this class from classes.json, skipping the AI categorization
    ],
    apiKey: process.env.GEMINI_API_KEY,
    languagePriority: 'german',
    outputDir: "./custom_labels",
    autoDosage: true,    // Generate text sizes like "5 mg"
    concentration: true, // ISO concentration "10 mg/ml" (default); false for an absolute bolus dose "5 mg"
    route: true,         // Append the route of administration, e.g. "i.v."
    scale: 1.0,          // Padding scale
    sizeScale: 0.9,      // Scaled down linear SVG size
    tonalBorder: true,   // Darker border on solid-color and split labels (not part of ISO 26825)
    nameOnly: false      // true: only the medication name, no dosage, unit or write-in line
});
```
