/**
 * @paperu/contracts — usb_toolbox.ts (90% §52-53).
 * The shared copy+verify result + request. Rust mirror at
 * src/filesystem/copy_verify.rs + src/commands/usb_toolbox.rs.
 */

export interface CopyVerifyResult {
  readonly destination: string;
  readonly sourceHash: string;
  readonly destHash: string;
  readonly bytesCopied: number;
  readonly verified: boolean;
}

export interface CopyVerifyRequest {
  readonly source: string;
  readonly destDir: string;
  readonly fileName: string;
  readonly conflictPolicy?: string | null;
}

export const UsbToolboxCommand = {
  CopyVerify: "copy_and_verify_file",
} as const;
