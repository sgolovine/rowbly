import { Box, type DOMElement, Text, useBoxMetrics, useInput } from 'ink';
import { useMemo, useRef, useState } from 'react';
import { errorMessage, RowblyError } from '../../../core';
import { invokePluginSync, type PluginInput } from '../../../services';
import {
  Form,
  type FormField,
  FormNavigationContext,
  type FormValues,
  normalizeFormValue,
  PluginSlot,
  ScrollBody,
  sameFormValue,
  Tabs,
  useCovered,
} from '../../components';
import { useDirty, useIsActive, useKeyHints, useLayout, usePlugins } from '../../hooks';
import type { KeyHint } from '../../keymap';
import { theme } from '../../theme';
import { PluginFailures } from './PluginFailures';
import { mergePluginInput, onPluginFields, type PluginFieldSet } from './pluginFields';

/** Host-owned create drafts. Saved Story tabs and the flat edit form have separate lifecycles. */
export function StoryCreateForm({
  boardId,
  fields,
  initialValues,
  extra,
  onSubmit,
  isActive: enabled = true,
  extraHints,
  pendingSummary,
}: {
  pendingSummary?: { label: string; value: string };
  isActive?: boolean;
  extraHints: readonly KeyHint[];
  boardId: string;
  fields: FormField[];
  initialValues: FormValues;
  extra: PluginFieldSet;
  onSubmit(values: FormValues, input: PluginInput): Promise<void>;
}) {
  const { plugins } = usePlugins();
  const layout = useLayout();
  const isActive = useIsActive();
  const covered = useCovered();
  const active = isActive && !covered && enabled;
  const [tab, setTab] = useState(0);
  const [values, setValues] = useState(initialValues);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [request, setRequest] = useState(0);
  const [draftFocus, setDraftFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = useRef(new Set<string>());
  const header = useRef<DOMElement>(null);
  const { height: headerHeight } = useBoxMetrics(header);
  const navigation = useMemo(
    () => ({
      extraHints,
      register(id: string, on: boolean) {
        if (on) editing.current.add(id);
        else editing.current.delete(id);
        return () => {
          editing.current.delete(id);
        };
      },
    }),
    [extraHints],
  );
  const tabs = plugins.flatMap((p) =>
    (p.tui.storyCreateTabs ?? []).map((contribution, i) => ({
      ...contribution,
      id: `${p.id}:${i}`,
      pluginId: p.id,
    })),
  );
  const selectedTab = tabs[tab - 1];
  const tabError = selectedTab ? errors[selectedTab.id] : undefined;
  const tabPlugins = new Set(tabs.map((t) => t.pluginId));
  const detailsFields = [
    ...fields,
    ...extra.fields.filter((f) => ![...tabPlugins].some((id) => f.name.startsWith(`plugin:${id}:`))),
  ];
  useDirty(
    [...fields, ...extra.fields].some(
      (f) => !sameFormValue(normalizeFormValue(f, values[f.name]), normalizeFormValue(f, initialValues[f.name])),
    ) || Object.values(drafts).some((draft) => draft !== undefined),
  );
  useKeyHints([
    { key: 'tab/←/→', description: 'switch tab' },
    { key: 'ctrl+s', description: 'save Story' },
    ...extraHints,
  ]);
  const switchTab = (delta: number) => setTab((at) => (at + delta + tabs.length + 1) % (tabs.length + 1));
  useInput(
    (input, key) => {
      if (busy || !active) return;
      if ((key.ctrl && input === 's') || (key.ctrl && key.return)) setRequest((n) => n + 1);
      else if (key.ctrl && input === 'g') setDraftFocus((value) => !value);
      else if (key.tab) switchTab(key.shift ? -1 : 1);
      else if (editing.current.size === 0 && (key.leftArrow || key.rightArrow)) switchTab(key.leftArrow ? -1 : 1);
    },
    { isActive: active },
  );

  const save = async (details: FormValues) => {
    if (busy || !active) return;
    setBusy(true);
    setErrors({});
    try {
      let input: PluginInput = {};
      for (const t of tabs) {
        if (failed.has(t.id) || !Object.hasOwn(drafts, t.id) || drafts[t.id] === undefined) continue;
        const converted = invokePluginSync({ plugin: t.pluginId, stage: 'field', operation: 'stories.create' }, () =>
          t.input(drafts[t.id]),
        );
        if (converted !== undefined) input = mergePluginInput(input, { [t.pluginId]: converted }) ?? input;
      }
      const current = { ...values, ...details };
      // Failed slots contribute neither draft input nor their relocated storyForm fields.
      for (const t of tabs)
        if (failed.has(t.id)) {
          for (const [name, value] of Object.entries(initialValues))
            if (name.startsWith(`plugin:${t.pluginId}:`)) current[name] = value;
        }
      await onSubmit(current, input);
    } catch (err) {
      const id = err instanceof RowblyError && typeof err.details.plugin === 'string' ? err.details.plugin : undefined;
      const index = tabs.findIndex((t) => t.pluginId === id);
      setTab(index + 1);
      const failedTab = tabs[index];
      if (failedTab) setErrors({ [failedTab.id]: errorMessage(err) });
      else throw onPluginFields(err, extra);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormNavigationContext.Provider value={navigation}>
      <Box flexDirection="column" flexGrow={1} height={layout.height}>
        <Box
          ref={header}
          backgroundColor={theme.overlayRaised}
          flexDirection="column"
          flexShrink={0}
          paddingX={1}
          paddingBottom={1}
          gap={1}
        >
          <Text bold>New Story on {boardId}</Text>
          <Tabs
            tabs={['Details', ...tabs.map((t) => t.label)]}
            selected={tab}
            active={active && !busy}
            onSelect={setTab}
          />
          {tabError && <Text color={theme.danger}>! {tabError}</Text>}
        </Box>
        <ScrollBody
          active={active}
          height={layout.height === undefined ? undefined : Math.max(1, layout.height - headerHeight)}
        >
          <Box display={tab === 0 ? 'flex' : 'none'} flexDirection="column">
            <Form
              fields={detailsFields}
              initialValues={initialValues}
              values={values}
              onChange={setValues}
              onSubmit={save}
              isActive={active && tab === 0 && !busy}
              submitRequest={request}
              onInvalid={() => setTab(0)}
            />
            {pendingSummary && (
              <Text>
                {pendingSummary.label}: {pendingSummary.value}
              </Text>
            )}
            <PluginFailures failures={extra.failures} note="its fields are unavailable" />
          </Box>
          {tabs.map((t, i) => {
            const Component = t.component;
            const ownFields = extra.fields.filter((f) => f.name.startsWith(`plugin:${t.pluginId}:`));
            return (
              <Box key={t.id} display={tab === i + 1 ? 'flex' : 'none'} flexDirection="column" gap={1}>
                {ownFields.length > 0 && <Text color={theme.inkFaint}>ctrl+g switch between fields and drafts</Text>}
                <PluginSlot
                  pluginId={t.pluginId}
                  onFailure={() => setFailed((prev) => new Set([...prev, t.id]))}
                  render={(plugin, ui) => (
                    <>
                      {ownFields.length > 0 && (
                        <Form
                          fields={ownFields}
                          initialValues={initialValues}
                          values={values}
                          onChange={setValues}
                          isActive={active && tab === i + 1 && !busy && !draftFocus}
                          onSubmit={() => setDraftFocus(true)}
                        />
                      )}
                      <Component
                        boardId={boardId}
                        active={active && tab === i + 1 && !busy && (ownFields.length === 0 || draftFocus)}
                        plugin={plugin}
                        ui={ui}
                        draft={drafts[t.id]}
                        onChange={(draft) => setDrafts((prev) => ({ ...prev, [t.id]: draft }))}
                      />
                    </>
                  )}
                />
              </Box>
            );
          })}
          {busy && <Text color={theme.inkFaint}>Saving…</Text>}
        </ScrollBody>
      </Box>
    </FormNavigationContext.Provider>
  );
}
