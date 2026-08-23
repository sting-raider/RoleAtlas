import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RESUME_PAGES,
  detectResumeKind,
  docxToText,
  extractResume,
} from "../lib/resumeExtract.ts";
import { inferProfile } from "../app/resumeProfile.ts";

/** Builds a structurally valid PDF with `pageCount` pages and one shared
 * content stream that draws every line. Base-14 Helvetica needs no embedding. */
function minimalPdf(pageCount: number, lines: string[]): Uint8Array {
  const escape = (value: string) => value.replace(/([\\()])/g, "\\$1");
  const content = [
    "BT /F1 12 Tf 14 TL",
    ...lines.map((line, index) => `${index === 0 ? "72 720 Td" : "0 -16 Td"} (${escape(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, pageIndex) => 4 + pageIndex * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const contentId = 4 + pageCount * 2;
  for (const [index, id] of pageIds.entries()) {
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  }
  objects[contentId] = "";

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < contentId; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(body);
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  const maxId = contentId;
  body += `xref\n0 ${maxId}\n0000000000 65535 f \n`;
  for (let id = 1; id < maxId; id += 1) {
    body += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Builds a minimal stored-entry ZIP container with one UTF-8 text member. */
function buildDocx(members: Array<{ name: string; body: string }>): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const nameBytes = Buffer.from(member.name, "utf8");
    const data = Buffer.from(member.body, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(0, 10); // stored
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, directory, eocd]));
}

function docxXml(paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;

test("files are identified by magic bytes, not names or claimed types", () => {
  assert.equal(detectResumeKind(new Uint8Array(minimalPdf(1, ["x"]))), "pdf");
  assert.equal(
    detectResumeKind(new Uint8Array(Buffer.from("PKnot really a zip"))),
    "docx",
  );
  assert.equal(detectResumeKind(new Uint8Array(Buffer.from("<html>renamed.pdf</html>"))), null);
  assert.equal(detectResumeKind(new Uint8Array(Buffer.from("MZ fake executable"))), null);
});

test("extracts skills with punctuation and role signals from a real PDF", async () => {
  const result = await extractResume("pdf", minimalPdf(1, [
    "Jordan Smith",
    "Bengaluru, India",
    "Skills: C++, C#, Node.js, TypeScript, PostgreSQL",
    "Built backend APIs and data analysis dashboards for two years.",
    "No degree required experience considered.",
  ]));
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.kind, "pdf");
  assert.ok(result.text.includes("C++"), "punctuated skill survives extraction");
  const profile = inferProfile(result.text);
  assert.deepEqual(profile.skills.filter((skill) => ["C++", "C#", "Node.js", "PostgreSQL"].includes(skill)), [
    "Node.js", "C++", "C#", "PostgreSQL",
  ]);
  assert.equal(profile.name, "Jordan Smith");
  assert.equal(profile.location, "Bengaluru, Karnataka, India");
});

test("a scanned or empty PDF fails with recovery guidance instead of garbage", async () => {
  const blank = await extractResume("pdf", minimalPdf(1, ["short"]));
  assert.equal(blank.ok, false);
  assert.equal(blank.reason, "scanned_or_empty");

  const headerOnly = await extractResume("pdf", new Uint8Array(Buffer.from("%PDF-1.4\ntrailer")));
  assert.equal(headerOnly.ok, false);
});

test("PDFs beyond the page cap are rejected before inference runs", async () => {
  const result = await extractResume("pdf", minimalPdf(MAX_RESUME_PAGES + 8, [
    "Alex Doe",
    "Senior generalist with a very long career across many pages of content.",
    "Software engineering, operations, writing, research, and customer support.",
    "Additional detail lines follow so the text floor passes without effort.",
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_many_pages");
  assert.match(result.message, new RegExp(String(MAX_RESUME_PAGES + 8)));
});

test("DOCX résumés extract with unicode names and international locations", async () => {
  const bytes = buildDocx([
    { name: "[Content_Types].xml", body: CONTENT_TYPES },
    {
      name: "word/document.xml",
      body: docxXml([
        "José García",
        "São Paulo, Brazil",
        "Skills: Node.js, PostgreSQL, Docker, Excel",
        "Two years building internal tools and dashboards for a logistics team.",
        "Equivalent practical experience accepted in place of a degree.",
      ]),
    },
  ]);
  const result = await extractResume("docx", bytes);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.kind, "docx");
  assert.ok(result.text.includes("José García"), "UTF-8 names survive XML stripping");
  const profile = inferProfile(result.text);
  assert.equal(profile.name, "José García");
  assert.equal(profile.location, "São Paulo, Brazil");
  assert.ok(profile.skills.includes("Node.js"));
});

test("entities and formatting tags do not leak into DOCX text", () => {
  const text = docxToText(Buffer.from(
    `<w:document><w:body><w:p><w:r><w:t>A &amp; B &lt;CT&gt;</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Next<w:br/>Line</w:t></w:r></w:p></w:body></w:document>`,
    "utf8",
  ));
  assert.equal(text, "A & B <CT>\nNext\nLine");
});

test("declared bomb sizes are rejected before inflation", async () => {
  // Hand-craft a central-directory entry claiming ~4 GB uncompressed.
  const eocd = Buffer.alloc(22 + 46 + 18);
  const memberName = "word/document.xml";
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const cdOffset = 22;
  eocd.writeUInt32LE(cdOffset, 16);
  const entryStart = cdOffset;
  eocd.writeUInt32LE(0x02014b50, entryStart);
  eocd.writeUInt16LE(8, entryStart + 10); // deflate
  eocd.writeUInt32LE(0xfffffff0, entryStart + 24); // declared uncompressed
  const nameLength = Buffer.byteLength(memberName, "utf8");
  eocd.writeUInt16LE(nameLength, entryStart + 28);
  eocd.writeUInt32LE(0, entryStart + 42); // local offset (empty area)
  Buffer.from(memberName, "utf8").copy(eocd, entryStart + 46);

  const result = await extractResume("docx", new Uint8Array(eocd));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreadable");
  assert.match(result.message, /safe processing limit/);
});
