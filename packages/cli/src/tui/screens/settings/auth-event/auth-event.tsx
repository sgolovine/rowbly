import { Box, Text } from "ink";
import { theme } from "../../../theme.js";
import type { AuthEvent } from "../auth-types.js";

/** One message of a provider during a sign-in: a URL to open, a device code, information or progress. */
export function AuthEventView({ event }: { event: AuthEvent }) {
  return (
    <Box flexDirection="column">
      {event.type === "auth_url" && (
        <>
          <Text color={theme.inkMuted}>{event.instructions ?? "Open this URL in a browser:"}</Text>
          <Text color={theme.ink} wrap="wrap">
            {event.url}
          </Text>
        </>
      )}
      {event.type === "device_code" && (
        <>
          <Text color={theme.inkMuted}>Open this URL and enter the code:</Text>
          <Text color={theme.ink} wrap="wrap">
            {event.verificationUri}
          </Text>
          <Text color={theme.ink} bold>
            {event.userCode}
          </Text>
        </>
      )}
      {event.type === "info" && (
        <>
          <Text color={theme.inkMuted} wrap="wrap">
            {event.message}
          </Text>
          {event.links?.map((link) => (
            <Text key={link.url} color={theme.ink} wrap="wrap">
              {link.label ? `${link.label}: ` : ""}
              {link.url}
            </Text>
          ))}
        </>
      )}
      {event.type === "progress" && <Text color={theme.inkFaint}>{event.message}</Text>}
    </Box>
  );
}
