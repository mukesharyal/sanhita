import * as pdfjsLib from "pdfjs-dist";
import documentIndex from "$lib/static/index.json";
import constitutionPdfUrl from "$lib/static/constitution.pdf?url";
import civilCodePdfUrl from "$lib/static/civil_code.pdf?url";
import criminalActPdfUrl from "$lib/static/criminal_act.pdf?url";
import electronicTransactionsActPdfUrl from "$lib/static/electronic_transactions_act.pdf?url";
import incomeTaxPdfUrl from "$lib/static/income_tax.pdf?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
).toString();

const PDF_FILE_ALIASES = {
    "national_code.pdf": "civil_code.pdf",
    "criminal_code.pdf": "criminal_act.pdf",
    "income_tax_act.pdf": "income_tax.pdf",
};

const PDF_URL_BY_FILE = {
    "constitution.pdf": constitutionPdfUrl,
    "civil_code.pdf": civilCodePdfUrl,
    "criminal_act.pdf": criminalActPdfUrl,
    "electronic_transactions_act.pdf": electronicTransactionsActPdfUrl,
    "income_tax.pdf": incomeTaxPdfUrl,
};

const KNOWN_PDF_FILES = new Set([
    ...Object.keys(PDF_URL_BY_FILE),
    ...(Array.isArray(documentIndex) ? documentIndex.map((doc) => doc?.file).filter(Boolean) : []),
]);

function normalizePdfFileName(fileName) {
    const raw = typeof fileName === "string" ? fileName.trim() : "";
    if (!raw) return "";

    const cleaned = raw
        .split("?")[0]
        .split("#")[0]
        .split("/")
        .pop()
        ?.trim()
        .toLowerCase();

    if (!cleaned || cleaned === "undefined") return "";

    const withExtension = cleaned.endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
    return PDF_FILE_ALIASES[withExtension] || withExtension;
}

export function resolvePdfFileName(fileName, fallback = "constitution.pdf") {
    const normalizedFallback = normalizePdfFileName(fallback) || "constitution.pdf";
    const candidate = normalizePdfFileName(fileName);

    if (!candidate) {
        return normalizedFallback;
    }

    if (!/^[a-z0-9._-]+\.pdf$/.test(candidate)) {
        return normalizedFallback;
    }

    if (!KNOWN_PDF_FILES.has(candidate)) {
        return normalizedFallback;
    }

    return candidate;
}

export function getPdfUrl(fileName, fallback = "constitution.pdf") {
    const safeFileName = resolvePdfFileName(fileName, fallback);
    return PDF_URL_BY_FILE[safeFileName] || PDF_URL_BY_FILE["constitution.pdf"];
}

export async function loadPDF() {
    const pdfUrl = getPdfUrl("constitution.pdf");
    return await pdfjsLib.getDocument(pdfUrl).promise;
}

export async function loadPDFByFile(fileName) {
    const pdfUrl = getPdfUrl(fileName, "constitution.pdf");
    return await pdfjsLib.getDocument(pdfUrl).promise;
}

export async function extractPages(pdfDoc, pageRanges) {
    let fullText = "";
    for (const [start, end] of pageRanges) {
        const clampedStart = Math.max(1, start);
        const clampedEnd = Math.min(pdfDoc.numPages, end);
        for (let i = clampedStart; i <= clampedEnd; i++) {
            const page = await pdfDoc.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map((item) => item.str).join(" ");
            fullText += `\n\n[Page ${i}]\n${pageText}`;
        }
    }
    return fullText;
}