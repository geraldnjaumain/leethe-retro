import { readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowDirectory = ".github/workflows";
const files = (await readdir(workflowDirectory)).filter((file) => file.endsWith(".yml")).sort();
const workflows = [];
for (const file of files) {
  const document = parse(await readFile(`${workflowDirectory}/${file}`, "utf8"));
  if (!document?.name || !document?.on || !document?.jobs) {
    throw new Error(`Workflow is missing name, on, or jobs: ${file}`);
  }
  if (!document.permissions) {
    throw new Error(`Workflow must declare least-privilege permissions: ${file}`);
  }
  for (const [jobName, job] of Object.entries(document.jobs)) {
    if (!job?.["runs-on"]) {
      throw new Error(`Workflow job is missing runs-on: ${file}#${jobName}`);
    }
    if (!Number.isFinite(job?.["timeout-minutes"])) {
      throw new Error(`Workflow job is missing timeout-minutes: ${file}#${jobName}`);
    }
  }
  if (Object.hasOwn(document.on, "schedule") && !Object.hasOwn(document.on, "workflow_dispatch")) {
    throw new Error(`Scheduled workflow must support manual recovery runs: ${file}`);
  }
  workflows.push({ file, document });
}

const workflowNames = new Set(workflows.map(({ document }) => document.name));
for (const { file, document } of workflows) {
  for (const dependency of document.on.workflow_run?.workflows ?? []) {
    if (!workflowNames.has(dependency)) {
      throw new Error(`Workflow references an unknown workflow "${dependency}": ${file}`);
    }
  }
}

const dependabot = parse(await readFile(".github/dependabot.yml", "utf8"));
if (dependabot?.version !== 2 || !Array.isArray(dependabot?.updates)) {
  throw new Error("Dependabot configuration is invalid.");
}

console.log(`Validated ${files.length} workflows and Dependabot configuration.`);
