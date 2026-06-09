import type { WorkBook, WorkSheet } from "xlsx";
import xlsx from "xlsx";

const MAX_VALUE_CHARS = 220;
const MAX_KEY_LINES_PER_PAGE = 12;
const MAX_TABLES_PER_PAGE = 3;
const MAX_TABLE_ROWS = 12;
const MAX_TABLE_CHARS = 1400;
const MAX_DOCUMENT_TABLES = 8;
const MAX_SHEETS = 8;
const MAX_KEY_ROWS_PER_SHEET = 18;
const MAX_FORMULAS_PER_SHEET = 25;
const MAX_COLUMNS_PER_ROW = 12;

const OFFER_KEYWORD_PATTERN = /\b(quote|quotation|estimate|scope|inclusion|exclusion|gst|subtotal|total|deposit|payment|allowance|variation|material|labou?r|supply|install|price|cost|rate|quantity|qty|sqm|m2|line item|provisional|prime cost|pc item|builder|trade|permit|approval|site)\b/i;
const MONEY_TEST_PATTERN = /(?:AUD\s*)?\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:AUD|dollars)\b/i;
const MONEY_MATCH_PATTERN = /(?:AUD\s*)?\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:AUD|dollars)\b/gi;
const QUANTITY_MATCH_PATTERN = /\b\d+(?:\.\d+)?\s?(?:m2|sqm|lm|mm|cm|m|kg|tonnes?|hrs?|hours?|days?|weeks?|each|ea|pcs?|units?)\b/gi;
const DATE_MATCH_PATTERN = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})\b/gi;
const TEXT_FIELD_PATTERN = /^(markdown|text|content|plainText|plain_text|ocrText|ocr_text|transcription)$/i;

type PrimitiveCell = string | number | boolean | null;

interface PageSummary {
    pageNumber: number;
    characterCount: number;
    keyLines: string[];
    amounts: string[];
    quantities: string[];
    dates: string[];
    tables: ExtractedTable[];
}

interface ExtractedTable {
    pageNumber?: number;
    rowCount: number;
    markdown: string;
}

interface SheetRowSummary {
    rowNumber: number;
    values: PrimitiveCell[];
}

interface SheetFormulaSummary {
    cell: string;
    formula: string;
    value?: PrimitiveCell;
    rowContext: PrimitiveCell[];
}

interface SheetTablePreview {
    startRow: number;
    headers: PrimitiveCell[];
    rows: PrimitiveCell[][];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\s+/g, " ").trim();
}

function truncateForPrompt(value: unknown, maxChars = MAX_VALUE_CHARS) {
    const text = cleanText(value);
    return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function uniqueBounded(values: unknown[], maxItems: number, maxChars = MAX_VALUE_CHARS) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const text = truncateForPrompt(value, maxChars);
        if (!text) continue;

        const key = text.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(text);
        if (result.length >= maxItems) break;
    }

    return result;
}

function normalizeCell(value: unknown): PrimitiveCell {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" || typeof value === "boolean") return value;
    return truncateForPrompt(value);
}

function normalizeRow(row: unknown[]): PrimitiveCell[] {
    return row.slice(0, MAX_COLUMNS_PER_ROW).map(normalizeCell);
}

function rowHasContent(row: PrimitiveCell[]) {
    return row.some((cell) => cell !== null && cleanText(cell) !== "");
}

function collectTextFields(value: unknown, depth = 0, parentKey = ""): string[] {
    if (depth > 5 || value === null || value === undefined) return [];

    if (typeof value === "string") {
        if (TEXT_FIELD_PATTERN.test(parentKey)) return [value];
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => collectTextFields(item, depth + 1, parentKey));
    }

    if (!isRecord(value)) return [];

    return Object.entries(value).flatMap(([key, nestedValue]) => {
        if (/image|base64|binary|buffer|embedding/i.test(key)) return [];
        if (typeof nestedValue === "string" && TEXT_FIELD_PATTERN.test(key)) return [nestedValue];
        return collectTextFields(nestedValue, depth + 1, key);
    });
}

function extractPageNumber(page: unknown, fallback: number) {
    if (!isRecord(page)) return fallback;
    const candidate = page.index ?? page.page ?? page.pageNumber ?? page.page_number;
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
}

function extractPatternMatches(text: string, pattern: RegExp, maxItems: number) {
    return uniqueBounded(text.match(pattern) ?? [], maxItems);
}

function lineLooksRelevant(line: string) {
    return OFFER_KEYWORD_PATTERN.test(line) || MONEY_TEST_PATTERN.test(line);
}

function selectRelevantLines(text: string, maxLines = MAX_KEY_LINES_PER_PAGE) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 2 && !/^[-=_\s]+$/.test(line));

    const relevantLines = lines.filter(lineLooksRelevant);
    return uniqueBounded(relevantLines.length > 0 ? relevantLines : lines, maxLines, 320);
}

function trimMarkdownTable(table: string) {
    const rows = table
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, MAX_TABLE_ROWS);

    return truncateForPrompt(rows.join("\n"), MAX_TABLE_CHARS);
}

function extractMarkdownTables(text: string) {
    const tables: string[] = [];
    const lines = text.split(/\r?\n/);
    let buffer: string[] = [];

    const flush = () => {
        if (buffer.length >= 2 && buffer.some((line) => /\|\s*:?-{2,}:?\s*\|/.test(line))) {
            tables.push(trimMarkdownTable(buffer.join("\n")));
        }
        buffer = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const looksLikeTableLine = trimmed.includes("|") && trimmed.split("|").length >= 3;

        if (looksLikeTableLine) {
            buffer.push(trimmed);
        } else {
            flush();
        }
    }

    flush();
    return uniqueBounded(tables, MAX_TABLES_PER_PAGE, MAX_TABLE_CHARS);
}

export function summarizeOcrPagesForOffer(pages: unknown, source?: { fileUrl?: string; fileName?: string }) {
    const pageArray = Array.isArray(pages) ? pages : pages ? [pages] : [];

    const pageSummaries: PageSummary[] = pageArray.map((page, index) => {
        const pageNumber = extractPageNumber(page, index + 1);
        const text = collectTextFields(page).join("\n");
        const tableMarkdown = extractMarkdownTables(text);

        return {
            pageNumber,
            characterCount: text.length,
            keyLines: selectRelevantLines(text),
            amounts: extractPatternMatches(text, MONEY_MATCH_PATTERN, 12),
            quantities: extractPatternMatches(text, QUANTITY_MATCH_PATTERN, 12),
            dates: extractPatternMatches(text, DATE_MATCH_PATTERN, 8),
            tables: tableMarkdown.map((markdown) => ({
                pageNumber,
                rowCount: markdown.split(/\r?\n/).length,
                markdown,
            })),
        };
    });

    const extractedTables = pageSummaries.flatMap((page) => page.tables).slice(0, MAX_DOCUMENT_TABLES);

    return {
        kind: "offer-document-summary",
        source: {
            fileName: source?.fileName,
            fileUrl: source?.fileUrl,
        },
        pageCount: pageArray.length,
        processedPageCount: pageSummaries.length,
        totals: {
            amountsFound: uniqueBounded(pageSummaries.flatMap((page) => page.amounts), 40).length,
            quantitiesFound: uniqueBounded(pageSummaries.flatMap((page) => page.quantities), 40).length,
            tablesFound: extractedTables.length,
        },
        extracted: {
            amounts: uniqueBounded(pageSummaries.flatMap((page) => page.amounts), 40),
            quantities: uniqueBounded(pageSummaries.flatMap((page) => page.quantities), 40),
            dates: uniqueBounded(pageSummaries.flatMap((page) => page.dates), 24),
            tables: extractedTables,
        },
        pages: pageSummaries.filter(
            (page) => page.keyLines.length > 0 || page.tables.length > 0 || page.amounts.length > 0,
        ),
        omitted: [
            "Raw OCR page objects are not returned.",
            "Only offer-relevant lines, detected amounts, quantities, dates, and bounded tables are included.",
        ],
    };
}

function getSheetRows(sheet: WorkSheet) {
    const ref = sheet["!ref"];
    if (!ref) return [];

    const range = xlsx.utils.decode_range(ref);
    const rows = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: true,
    }) as unknown[][];

    return rows.map((row, index) => ({
        rowNumber: range.s.r + index + 1,
        values: normalizeRow(row),
    })).filter((row) => rowHasContent(row.values));
}

function sheetDimensions(sheet: WorkSheet) {
    const ref = sheet["!ref"];
    if (!ref) {
        return { range: null, rowCount: 0, columnCount: 0 };
    }

    const range = xlsx.utils.decode_range(ref);
    return {
        range: ref,
        rowCount: range.e.r - range.s.r + 1,
        columnCount: range.e.c - range.s.c + 1,
    };
}

function rowLooksRelevant(row: SheetRowSummary) {
    const rowText = row.values.map((value) => cleanText(value)).join(" ");
    return OFFER_KEYWORD_PATTERN.test(rowText) || MONEY_TEST_PATTERN.test(rowText);
}

function extractFormulas(sheet: WorkSheet, rows: SheetRowSummary[]) {
    const byRow = new Map(rows.map((row) => [row.rowNumber, row.values]));
    const formulas: SheetFormulaSummary[] = [];

    for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) continue;

        const cell = sheet[address] as { f?: string; v?: unknown; w?: string } | undefined;
        if (!cell?.f) continue;

        const decoded = xlsx.utils.decode_cell(address);
        formulas.push({
            cell: address,
            formula: truncateForPrompt(cell.f, 320),
            value: normalizeCell(cell.w ?? cell.v),
            rowContext: byRow.get(decoded.r + 1) ?? [],
        });

        if (formulas.length >= MAX_FORMULAS_PER_SHEET) break;
    }

    return formulas;
}

function inferPreviewTable(rows: SheetRowSummary[]): SheetTablePreview | null {
    const start = rows.findIndex((row) => row.values.filter((value) => value !== null).length >= 2);
    if (start === -1) return null;

    const previewRows = rows.slice(start, start + MAX_TABLE_ROWS);
    const [header, ...body] = previewRows;
    if (!header) return null;

    return {
        startRow: header.rowNumber,
        headers: header.values,
        rows: body.map((row) => row.values),
    };
}

function extractNamedRanges(workbook: WorkBook) {
    const names = workbook.Workbook?.Names ?? [];
    return names.slice(0, 30).map((name) => ({
        name: truncateForPrompt(name.Name),
        ref: truncateForPrompt(name.Ref),
        sheetIndex: typeof name.Sheet === "number" ? name.Sheet : undefined,
    }));
}

export function summarizeWorkbookForOffer(workbook: WorkBook, source: { sheetType: "sample" | "template" }) {
    const sheets = workbook.SheetNames.slice(0, MAX_SHEETS).map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return null;

        const rows = getSheetRows(sheet);
        const keyRows = rows.filter(rowLooksRelevant).slice(0, MAX_KEY_ROWS_PER_SHEET);
        const formulas = extractFormulas(sheet, rows);
        const previewTable = inferPreviewTable(rows);

        return {
            name: sheetName,
            ...sheetDimensions(sheet),
            nonEmptyRowCount: rows.length,
            keyRows,
            formulas,
            tables: previewTable ? [previewTable] : [],
        };
    }).filter((sheet) => sheet !== null);

    return {
        kind: "offer-workbook-summary",
        sheetType: source.sheetType,
        sheetCount: workbook.SheetNames.length,
        includedSheetCount: sheets.length,
        sheetNames: workbook.SheetNames,
        namedRanges: extractNamedRanges(workbook),
        sheets,
        pricingContext: uniqueBounded(
            sheets.flatMap((sheet) => [
                ...sheet.keyRows.map((row) => `${sheet.name} row ${row.rowNumber}: ${row.values.map(cleanText).filter(Boolean).join(" | ")}`),
                ...sheet.formulas.map((formula) => `${sheet.name}!${formula.cell}: ${formula.formula} -> ${cleanText(formula.value)}`),
            ]),
            40,
            320,
        ),
        omitted: [
            "Raw xlsx WorkBook objects are not returned.",
            "Only sheet dimensions, named ranges, relevant rows, formulas, and bounded table previews are included.",
        ],
    };
}