import { Box } from 'ink';
import { SelectList } from '../components';
import { DESTINATIONS, type Destination } from '../keymap';

export function GotoPalette({ onPick }: { onPick(destination: Destination): void }) {
  return (
    <Box flexDirection="column">
      <SelectList
        items={DESTINATIONS.map((d) => ({ value: d.label, label: d.label }))}
        limit={DESTINATIONS.length}
        onSelect={(item) => {
          const destination = DESTINATIONS.find((d) => d.label === item.value);
          if (destination) onPick(destination);
        }}
      />
    </Box>
  );
}
