export interface RescueDiagnosis {
  readonly path: string;
  readonly fileKind: string;
  readonly status: string;
  readonly message: string;
  readonly recoverable: boolean;
}
export const RescueCommand = { Diagnose: "diagnose_file" } as const;
