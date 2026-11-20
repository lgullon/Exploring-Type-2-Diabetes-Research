// Readers for AACT pipe-delimited flat files.
//
// Each table is a text file whose first line is a header. Fields are separated
// by "|". A field that contains "|", a double quote or a line break is wrapped
// in double quotes, with embedded quotes doubled (""), so one record can span
// several physical lines.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export type Row = Record<string, string>;

/** Split one complete record (which may contain quoted line breaks) into fields. */
export function splitRecord(record: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  let atFieldStart = true;
  for (let i = 0; i < record.length; i++) {
    const c = record[i];
    if (quoted) {
      if (c === '"') {
        if (record[i + 1] === '"') { current += '"'; i++; }
        else quoted = false;
      } else current += c;
    } else if (c === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (c === '|') {
      fields.push(current);
      current = '';
      atFieldStart = true;
    } else {
      current += c;
      atFieldStart = false;
    }
  }
  fields.push(current);
  return fields;
}

function quoteCount(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 34) n++;
  return n;
}

/** Yield one object per record, keyed by the header names. */
export async function* readRows(input: Readable): AsyncGenerator<Row> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header: string[] | null = null;
  let pending = '';
  let quotes = 0;
  let open = false;
  for await (const line of lines) {
    pending = open ? `${pending}\n${line}` : line;
    quotes += quoteCount(line);
    // An odd number of quote characters means a quoted field is still open.
    open = quotes % 2 === 1;
    if (open) continue;
    quotes = 0;
    const fields = splitRecord(pending);
    if (header === null) {
      header = fields;
      continue;
    }
    if (fields.length !== header.length) {
      throw new Error(`Malformed AACT record: expected ${header.length} fields, found ${fields.length}: ${pending.slice(0, 120)}`);
    }
    const row: Row = {};
    header.forEach((name, i) => { row[name] = fields[i]; });
    yield row;
  }
  if (open) throw new Error('Malformed AACT file: unterminated quoted field at end of file');
}

export function readTable(path: string): AsyncGenerator<Row> {
  return readRows(createReadStream(path, { encoding: 'utf8' }));
}
