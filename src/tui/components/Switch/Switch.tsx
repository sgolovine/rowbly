import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

export interface SwitchProps {
  on: boolean;
  /** The text beside the track while on. */
  onLabel?: string;
  /** The text beside the track while off. */
  offLabel?: string;
  /** A click toggles the switch. Without it, the switch only shows its state. */
  onChange?(on: boolean): void;
  clickable?: boolean;
}

/** An on/off control: a track with its knob (`━━●` on, `●──` off) and the label of its state. */
export function Switch({ on, onLabel = "On", offLabel = "Off", onChange, clickable = true }: SwitchProps) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick: () => onChange?.(!on) }, clickable && onChange !== undefined);
  return (
    <Box ref={ref} gap={1} flexShrink={0}>
      <Text color={on ? theme.ink : theme.inkFaint}>{on ? "━━●" : "●──"}</Text>
      <Text color={on ? theme.ink : theme.inkMuted}>{on ? onLabel : offLabel}</Text>
    </Box>
  );
}
