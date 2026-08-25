//! Résumé file extraction with structural validation.
//!
//! Files are identified by magic bytes rather than MIME type or extension, so
//! a renamed text file or an HTML wrapper can never reach the PDF or DOCX
//! parsers. Extraction bounds are enforced structurally (page count for PDFs,
//! declared and inflated byte ceilings for DOCX members) so decompression
//! bombs and pathological documents fail fast with deterministic messages.

import { inflateRawSync } from "node:zlib";

/** Interactive onboarding never needs more than this many résumé pages. */
export const MAX_RESUME_PAGES = 12;
/** Upload ceiling enforced on the request stream before anything buffers. */
export const MAX_RESUME_BYTES = 8 * 1024 * 1024;
/** Hard ceiling on extracted text handed to inference or AI features. */
export const MAX_RESUME_TEXT_CHARS = 60_000;
/** Minimum readable text before a file is treated as a scan or an export bug. */
export const MIN_RESUME_TEXT_CHARS = 80;
/** Ceiling on a single inflated DOCX member, independent of its archive size. */
const MAX_DOCX_MEMBER_BYTES = 24 * 1024 * 1024;

export type ResumeKind = "pdf" | "docx";

export type ExtractionSuccess = {
  ok: true;
  kind: ResumeKind;
  text: string;
  /** PDFs report their true page count; DOCX has no page model, so the value
   * is a length-based estimate and never rendered as an exact count. */
  totalPages: number;
};

export type ExtractionFailure = {
  ok: false;
  reason: "unsupported" | "unreadable" | "too_large_text" | "too_many_pages" | "scanned_or_empty";
  message: string;
};

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export function detectResumeKind(bytes: Uint8Array): ResumeKind | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf"; // %PDF-
  // ZIP local-file-header variants cover DOCX produced by Word and writers.
  if (
    startsWith(0x50, 0x4b, 0x03, 0x04) ||
    startsWith(0x50, 0x4b, 0x05, 0x06) ||
    startsWith(0x50, 0x4b, 0x07, 0x08)
  ) {
    return "docx";
  }
  return null;
}

export async function extractResume(
  kind: ResumeKind,
  bytes: Uint8Array,
): Promise<ExtractionResult> {
  if (kind === "pdf") return extractPdf(bytes);
  return extractDocxBytes(bytes);
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  let parsed: { text: string; totalPages: number };
  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(bytes, { mergePages: true });
    parsed = { text: String(result?.text ?? ""), totalPages: Number(result?.totalPages ?? 0) };
  } catch {
    return {
      ok: false,
      reason: "unreadable",
      message: "This PDF could not be parsed. Export it again from your editor and try once more.",
    };
  }
  if (parsed.totalPages > MAX_RESUME_PAGES) {
    return {
      ok: false,
      reason: "too_many_pages",
      message: `Résumés are limited to ${MAX_RESUME_PAGES} pages; this PDF reports ${parsed.totalPages}.`,
    };
  }
  return finish(parsed.text.replace(/\0/g, ""), "pdf", parsed.totalPages);
}

/**
 * Minimal DOCX reader: parses the ZIP central directory, inflates only
 * `word/document.xml`, and converts its paragraphs to plain text. No general
 * unzip surface is exposed, and member inflation is bounded before and after.
 */
export function extractDocxBytes(bytes: Uint8Array): ExtractionResult {
  let documentXml: Buffer;
  try {
    documentXml = readZipMember(Buffer.from(bytes), "word/document.xml");
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      message:
        error instanceof Error && error.message.startsWith("This document")
          ? error.message
          : "This document could not be opened. Save it as .docx from Word, Google Docs, or LibreOffice.",
    };
  }
  return finish(docxToText(documentXml), "docx", estimateDocxPages(documentXml));
}

function finish(rawText: string, kind: ResumeKind, totalPages: number): ExtractionResult {
  const cleaned = rawText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length < MIN_RESUME_TEXT_CHARS) {
    return {
      ok: false,
      reason: "scanned_or_empty",
      message:
        "Too little readable text was found. If this is a scanned image, export a text-based copy instead — RoleAtlas does not run OCR by default.",
    };
  }
  if (cleaned.length > MAX_RESUME_TEXT_CHARS * 2) {
    return {
      ok: false,
      reason: "too_large_text",
      message: "This document contains far more text than a résumé needs.",
    };
  }
  return {
    ok: true,
    kind,
    text: cleaned.slice(0, MAX_RESUME_TEXT_CHARS),
    totalPages,
  };
}

function estimateDocxPages(xml: Buffer): number {
  const characters = xml.length;
  return Math.max(1, Math.ceil(characters / 12_000));
}

function readZipMember(buffer: Buffer, memberName: string): Buffer {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new Error("This document is not a valid DOCX container.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("This document's archive index is unreadable.");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== memberName) continue;

    if (uncompressedSize > MAX_DOCX_MEMBER_BYTES) {
      throw new Error(`This document expands beyond the safe processing limit (${name}).`);
    }
    const nameLengthLocal = buffer.readUInt16LE(localOffset + 26);
    const extraLengthLocal = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLengthLocal + extraLengthLocal;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) {
      const inflated = inflateRawSync(data, { maxOutputLength: MAX_DOCX_MEMBER_BYTES });
      if (inflated.length > MAX_DOCX_MEMBER_BYTES) {
        throw new Error(`This document expands beyond the safe processing limit (${name}).`);
      }
      return inflated;
    }
    throw new Error(`This document uses an unsupported compression method (${name}).`);
  }
  throw new Error(`This document does not contain ${memberName}; it may not be a real DOCX.`);
}

export function docxToText(xml: Buffer): string {
  return Buffer.from(xml)
    .toString("utf8")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+$/, "");
}
