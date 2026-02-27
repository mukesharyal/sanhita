import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
).toString();

export async function loadPDF() {
    const pdfUrl = new URL("../lib/static/constitution.pdf", import.meta.url).toString();
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