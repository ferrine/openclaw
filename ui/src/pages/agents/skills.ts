import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { SkillStatusReport } from "../../api/types.ts";
import { resolveAgentSkillsFilter } from "../../lib/agents/display.ts";
import { currentConfigObject } from "../../lib/config/config-state-model.ts";
import type { RuntimeConfigCapability } from "../../lib/config/runtime-config-capability.ts";
import { formatUiError } from "../../lib/format-error.ts";
import { loadSkillStatusReport } from "../../lib/skills/status-report.ts";

export type AgentSkillsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  requestGeneration: number;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
};

export async function loadAgentSkills(state: AgentSkillsState, agentId: string) {
  const client = state.client;
  if (!client || !state.connected || state.agentSkillsLoading) {
    return;
  }
  const generation = state.requestGeneration;
  const isCurrent = () =>
    state.client === client && state.connected && state.requestGeneration === generation;
  state.agentSkillsLoading = true;
  state.agentSkillsError = null;
  try {
    const res = await loadSkillStatusReport(client, agentId);
    if (res && isCurrent()) {
      state.agentSkillsReport = res;
      state.agentSkillsAgentId = agentId;
    }
  } catch (err) {
    if (isCurrent()) {
      state.agentSkillsError = formatUiError(err);
    }
  } finally {
    if (isCurrent()) {
      state.agentSkillsLoading = false;
    }
  }
}

export async function clearAgentSkillFilter(
  runtimeConfig: RuntimeConfigCapability,
  agentId: string,
  canDispatch: () => boolean = () => true,
): Promise<boolean> {
  const target = runtimeConfig.agentEntry(agentId);
  if (!target || !Array.isArray(target.entry.skills) || !canDispatch()) {
    return false;
  }
  const targetKey = target.path[2];
  if (typeof targetKey !== "string") {
    return false;
  }
  return runtimeConfig.patch({
    raw: {
      agents: {
        entries: {
          [targetKey]: { skills: null },
        },
      },
    },
    note: "Reset agent skills to inherited defaults",
    replacePaths: [`agents.entries.${targetKey}.skills`],
    canDispatch,
  });
}

export function createAgentSkillActions(params: {
  getRuntimeConfig: () => RuntimeConfigCapability;
  getReport: () => SkillStatusReport | null;
  canUpdate: (agentId: string) => boolean;
}) {
  return {
    onToggle: (agentId: string, skillName: string, enabled: boolean) => {
      if (!params.canUpdate(agentId)) {
        return;
      }
      const target = params.getRuntimeConfig().agentEntry(agentId, { ensure: true });
      if (!target || !skillName.trim()) {
        return;
      }
      const report = params.getReport();
      const base =
        resolveAgentSkillsFilter(currentConfigObject(params.getRuntimeConfig().state), agentId) ??
        report?.agentSkillFilter ??
        report?.skills?.map((skill) => skill.name).filter(Boolean) ??
        [];
      const next = new Set(base);
      if (enabled) {
        next.add(skillName.trim());
      } else {
        next.delete(skillName.trim());
      }
      params.getRuntimeConfig().patchForm([...target.path, "skills"], [...next]);
    },
    onDisableAll: (agentId: string) => {
      if (!params.canUpdate(agentId)) {
        return;
      }
      const target = params.getRuntimeConfig().agentEntry(agentId, { ensure: true });
      if (target) {
        params.getRuntimeConfig().patchForm([...target.path, "skills"], []);
      }
    },
  };
}
