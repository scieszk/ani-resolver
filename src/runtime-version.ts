export const minimumNodeMajor = 24;

export interface UnsupportedRuntimeError {
  schemaVersion: "ani-resolver.error.v1";
  error: {
    code: "unsupported_node_version";
    message: string;
    details: {
      current: string;
      required: string;
    };
  };
}

export function runtimeVersionError(version: string): UnsupportedRuntimeError | undefined {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isInteger(major) && major >= minimumNodeMajor) return undefined;
  return {
    schemaVersion: "ani-resolver.error.v1",
    error: {
      code: "unsupported_node_version",
      message: `ani-resolver requires Node.js ${minimumNodeMajor} or newer; current version is ${version}`,
      details: {
        current: version,
        required: `>=${minimumNodeMajor}`,
      },
    },
  };
}
