import { Box, Text } from 'ink';
import { SelectList } from '../../components';
import { useKeyHints } from '../../hooks';
import { useRouter } from '../../router';

export function OnboardingSettings() {
  const router = useRouter();
  useKeyHints([{ key: 'enter', description: 'reopen onboarding' }]);
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Revisit onboarding safely. Completion stays set while you review or change your choices.</Text>
      <SelectList
        items={[
          { value: 'global', label: 'Global — Me and known Data Roots' },
          { value: 'root', label: 'This Data Root — Boards, Plugins and agents' },
        ]}
        onSelect={(item) => router.push('onboarding', { level: item.value, reopen: true, title: 'Onboarding' })}
      />
    </Box>
  );
}
