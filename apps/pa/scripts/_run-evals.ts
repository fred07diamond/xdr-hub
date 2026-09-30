// The framework CLI loads *.eval.ts with Node type stripping, which does not map
// the codebase's ".js" import specifiers to ".ts". This runs the same suite API under tsx.
// Until M1 every non-skipped eval brings its own deterministic run(), so the suite gets a
// runner that refuses agent calls instead of resolving an engine and discovering actions.
import {
  formatReport,
  runEvalSuite,
  type AgentRunner,
} from "@agent-native/core/eval";

const args = process.argv.slice(2);
const json = args.includes("--json");
const pattern = args.find((arg) => !arg.startsWith("-"));

const refuse = (): never => {
  throw new Error(
    "This eval needs the agent runner, which arrives with the M1 agent steps.",
  );
};
const noAgentRunner = {
  engine: {},
  model: "none",
  runAgent: async () => refuse(),
  analyzeContext: refuse,
} as unknown as AgentRunner;

const { report } = await runEvalSuite({
  cwd: process.cwd(),
  pattern,
  persist: false,
  runner: noAgentRunner,
});
console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
process.exit(report.failed > 0 ? 1 : 0);
