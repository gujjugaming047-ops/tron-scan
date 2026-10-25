declare module "qrcode" {
  interface QrFileOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    type?: "png" | "svg";
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
  }

  export function toFile(path: string, text: string, options?: QrFileOptions): Promise<void>;
  export function toString(text: string, options?: QrFileOptions): Promise<string>;
  export function create(
    text: string | Array<{ data: string; mode?: string }>,
    options?: QrFileOptions,
  ): {
    modules: {
      size: number;
      get(row: number, col: number): number;
    };
  };
}
