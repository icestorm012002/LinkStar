import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Suspense, use, useEffect, useState } from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { Box, Text, useTheme } from '../../ink.js';
import { type AppState, useAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js';
import { getLatestRuntimeTranscriptModel } from '../../utils/stats.js';
import { buildAccountProperties, buildAPIProviderProperties, buildIDEProperties, buildInstallationDiagnostics, buildInstallationHealthDiagnostics, buildMcpProperties, buildMemoryDiagnostics, buildSandboxProperties, buildSettingSourcesProperties, type Diagnostic, getModelDisplayLabel, getRuntimeBackendInfo, type Property } from '../../utils/status.js';
import type { ThemeName } from '../../utils/theme.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
type Props = {
  context: LocalJSXCommandContext;
  diagnosticsPromise: Promise<Diagnostic[]>;
};
function buildPrimarySection(): Property[] {
  const sessionId = getSessionId();
  const customTitle = getCurrentSessionTitle(sessionId);
  const nameValue = customTitle ?? <Text dimColor>/rename to add a name</Text>;
  return [{
    label: 'Version',
    value: MACRO.VERSION
  }, {
    label: 'Session name',
    value: nameValue
  }, {
    label: 'Session ID',
    value: sessionId
  }, {
    label: 'cwd',
    value: getCwd()
  }, ...buildAccountProperties(), ...buildAPIProviderProperties()];
}
function buildSecondarySection({
  mainLoopModel,
  mcp,
  theme,
  context,
  runtimeProviderInfo,
  runtimeModelId,
  selectedModelId
}: {
  mainLoopModel: AppState['mainLoopModel'];
  mcp: AppState['mcp'];
  theme: ThemeName;
  context: LocalJSXCommandContext;
  runtimeProviderInfo: ReturnType<typeof getRuntimeBackendInfo>;
  runtimeModelId: string | null;
  selectedModelId: string | null;
}): Property[] {
  const modelLabel = getModelDisplayLabel(mainLoopModel);
  return [{
    label: 'Inference routing',
    value: 'The active runtime provider is determined by the selected Model (openai-codex/* => Codex, google-gemini/* => Gemini, otherwise Claude).'
  }, ...(runtimeProviderInfo ? [{
    label: 'Runtime provider',
    value: runtimeProviderInfo.providerLabel
  }] : []), ...(runtimeModelId ? [{
    label: 'Last response model ID',
    value: runtimeModelId
  }] : []), ...(selectedModelId ? [{
    label: 'Current selected model ID',
    value: selectedModelId
  }] : []), {
    label: 'Model',
    value: modelLabel
  }, ...buildIDEProperties(mcp.clients, context.options.ideInstallationStatus, theme), ...buildMcpProperties(mcp.clients, theme), ...buildSandboxProperties(), ...buildSettingSourcesProperties()];
}
export async function buildDiagnostics(): Promise<Diagnostic[]> {
  return [...(await buildInstallationDiagnostics()), ...(await buildInstallationHealthDiagnostics()), ...(await buildMemoryDiagnostics())];
}
function PropertyValue(t0) {
  const $ = _c(8);
  const {
    value
  } = t0;
  if (Array.isArray(value)) {
    let t1;
    if ($[0] !== value) {
      let t2;
      if ($[2] !== value.length) {
        t2 = (item, i) => <Text key={i}>{item}{i < value.length - 1 ? "," : ""}</Text>;
        $[2] = value.length;
        $[3] = t2;
      } else {
        t2 = $[3];
      }
      t1 = value.map(t2);
      $[0] = value;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[4] !== t1) {
      t2 = <Box flexWrap="wrap" columnGap={1} flexShrink={99}>{t1}</Box>;
      $[4] = t1;
      $[5] = t2;
    } else {
      t2 = $[5];
    }
    return t2;
  }
  if (typeof value === "string") {
    let t1;
    if ($[6] !== value) {
      t1 = <Text>{value}</Text>;
      $[6] = value;
      $[7] = t1;
    } else {
      t1 = $[7];
    }
    return t1;
  }
  return value;
}
export function Status(t0) {
  const $ = _c(20);
  const {
    context,
    diagnosticsPromise
  } = t0;
  const mainLoopModel = useAppState(_temp);
  const mcp = useAppState(_temp2);
  const [runtimeTranscriptModel, setRuntimeTranscriptModel] = useState<string | null>(null);
  const [theme] = useTheme();
  useEffect(() => {
    let cancelled = false;
    getLatestRuntimeTranscriptModel().then(model => {
      if (!cancelled) {
        setRuntimeTranscriptModel(model);
      }
    }).catch(() => {
      if (!cancelled) {
        setRuntimeTranscriptModel(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mainLoopModel]);
  const runtimeProviderInfo = getRuntimeBackendInfo(mainLoopModel);
  const selectedModelId = runtimeProviderInfo?.selectedModelId ?? null;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = buildPrimarySection();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== context || $[2] !== mainLoopModel || $[3] !== mcp || $[4] !== runtimeProviderInfo || $[5] !== runtimeTranscriptModel || $[6] !== selectedModelId || $[7] !== theme) {
    t2 = buildSecondarySection({
      mainLoopModel,
      mcp,
      theme,
      context,
      runtimeProviderInfo,
      runtimeModelId: runtimeTranscriptModel ?? selectedModelId,
      selectedModelId
    });
    $[1] = context;
    $[2] = mainLoopModel;
    $[3] = mcp;
    $[4] = runtimeProviderInfo;
    $[5] = runtimeTranscriptModel;
    $[6] = selectedModelId;
    $[7] = theme;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  let t3;
  if ($[9] !== t2) {
    t3 = [t1, t2];
    $[9] = t2;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  const sections = t3;
  const grow = useIsInsideModal() ? 1 : undefined;
  let t4;
  if ($[11] !== sections) {
    t4 = sections.map(_temp4);
    $[11] = sections;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  let t5;
  if ($[13] !== diagnosticsPromise) {
    t5 = <Suspense fallback={null}><Diagnostics promise={diagnosticsPromise} /></Suspense>;
    $[13] = diagnosticsPromise;
    $[14] = t5;
  } else {
    t5 = $[14];
  }
  let t6;
  if ($[15] !== grow || $[16] !== t4 || $[17] !== t5) {
    t6 = <Box flexDirection="column" gap={1} flexGrow={grow}>{t4}{t5}</Box>;
    $[15] = grow;
    $[16] = t4;
    $[17] = t5;
    $[18] = t6;
  } else {
    t6 = $[18];
  }
  let t7;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text dimColor={true}><ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" /></Text>;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  const t8 = <Box flexDirection="column" flexGrow={grow}>{t6}{t7}</Box>;
  return t8;
}
function _temp4(properties, i) {
  return properties.length > 0 && <Box key={i} flexDirection="column">{properties.map(_temp3)}</Box>;
}
function _temp3(t0, j) {
  const {
    label,
    value
  } = t0;
  return <Box key={j} flexDirection="row" gap={1} flexShrink={0}>{label !== undefined && <Text bold={true}>{label}:</Text>}<PropertyValue value={value} /></Box>;
}
function _temp2(s_0) {
  return s_0.mcp;
}
function _temp(s) {
  return s.mainLoopModel;
}
function Diagnostics(t0) {
  const $ = _c(5);
  const {
    promise
  } = t0;
  const diagnostics = use(promise) as any[];
  if (diagnostics.length === 0) {
    return null;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text bold={true}>System Diagnostics</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== diagnostics) {
    t2 = diagnostics.map(_temp5);
    $[1] = diagnostics;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== t2) {
    t3 = <Box flexDirection="column" paddingBottom={1}>{t1}{t2}</Box>;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
function _temp5(diagnostic, i) {
  return <Box key={i} flexDirection="row" gap={1} paddingX={1}><Text color="error">{figures.warning}</Text>{typeof diagnostic === "string" ? <Text wrap="wrap">{diagnostic}</Text> : diagnostic}</Box>;
}
