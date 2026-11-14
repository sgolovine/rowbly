import { useContext, useEffect, useMemo } from "react";
import { uniqueKeys, useIsActive, useLayout } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { ModalProps } from "../modal/index.js";
import { ModalLayerContext } from "../modal-layer.js";
import { modalSize } from "../modal-size.js";
import { type FormLead, useModalLayers } from "../use-modal-layers.js";

const FORM_ESC = { key: "esc", description: "cancel" };

/** The modal's own hints. A titled modal without hints still says how to close it. */
function ownHints(hints: readonly KeyHint[] | undefined, title: string | undefined): readonly KeyHint[] | undefined {
  if (hints?.length) {
    return hints;
  }

  return title ? [{ key: "esc", description: "close" }] : undefined;
}

/** The hint strip. A Form inside adds its keys first, and there `esc` cancels. */
function footerHints(leads: readonly FormLead[], own: readonly KeyHint[] | undefined): readonly KeyHint[] | undefined {
  if (leads.length === 0) {
    return own;
  }

  return uniqueKeys([
    ...leads.flatMap((lead) => lead.keys),
    ...(own ?? []).filter((hint) => hint.key !== "esc"),
    FORM_ESC,
  ]);
}

/**
 * An info modal only shows information: its one key is `esc`, so it offers a Close Button instead of the
 * hint strip. Screen Modals keep their strip.
 */
function isInfo(screen: boolean, leads: readonly FormLead[], footer: readonly KeyHint[] | undefined): boolean {
  return !screen && leads.length === 0 && footer?.length === 1 && footer[0]?.key === "esc";
}

/** The layers, the Form keys, the size and the hint strip of a `ModalFrame`. */
export function useModalFrame({
  title,
  hints,
  size = "panel",
  maxWidth = size === "screen" ? 120 : 72,
  onClose,
  focused = true,
  flush = false,
}: ModalProps) {
  const parentLayer = useContext(ModalLayerContext);
  const active = useIsActive();
  const { host, registerLayer, registerForm, covered, leads } = useModalLayers();
  const outer = useLayout();

  const screen = size === "screen";
  const overlay = outer.height !== undefined;
  // Only the top layer, the one in focus, shows its frame in accent, its `✕` and its keys.
  const top = focused && active && !covered;
  const footer = footerHints(leads, ownHints(hints, title));
  const info = isInfo(screen, leads, footer) ? onClose : undefined;
  const { width, room, body } = modalSize(outer, { size, maxWidth, footer: footer !== undefined, flush });
  // Kept stable, so content that reads the layout does not render again whenever a layer shows.
  const bodyLayout = useMemo(() => ({ width: body.width, height: body.height }), [body.width, body.height]);
  // A generic modal fits its content, so its body can be too short for a layer, and the body clips what
  // it holds. Its layers go over the area around the modal instead.
  const floatLayers = overlay && !screen;

  useEffect(() => parentLayer?.(), [parentLayer]);

  return {
    registerLayer,
    registerForm,
    host,
    outer,
    bodyLayout,
    screen,
    overlay,
    covered,
    top,
    footer,
    info,
    width,
    room,
    body,
    floatLayers,
  };
}
