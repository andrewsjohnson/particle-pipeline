export function buildWGSLParamsStruct(name: string, spec: Record<string, string>) {
    let members = Object.entries(spec)
      .map(([key, wgslType]) => `    ${key}: ${wgslType},`)
      .join("\n");
  
    return `
        struct ${name} {
        ${members}
        };
        @group(0) @binding(2) var<uniform> P : ${name};
    `;
  }