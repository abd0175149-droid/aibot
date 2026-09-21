/** pdf-parse لا يشحن أنواعاً — تعريفٌ أدنى لما نستعمله فعلاً. */
declare module 'pdf-parse' {
  interface PdfResult {
    text: string;
    numpages: number;
    info?: Record<string, unknown>;
  }
  export default function pdfParse(data: Buffer): Promise<PdfResult>;
}
