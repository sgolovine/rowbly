import { Box, Text } from 'ink';
import { Button } from '../../components';
import { theme } from '../../theme';

/** Onboarding's Back, Next and Skip onboarding Buttons, each with its key in a key cap. */
export function OnboardingNav({
  onBack,
  onNext,
  onSkip,
  first,
  last,
  clickable,
}: {
  onBack(): void;
  onNext(): void;
  onSkip(): void;
  first: boolean;
  last: boolean;
  clickable: boolean;
}) {
  return (
    <Box>
      {!first && (
        <>
          <Button label="Back" keyName="shift+←" onClick={onBack} clickable={clickable} compact />
          <Text color={theme.borderControl}>|</Text>
        </>
      )}
      <Button
        label={last ? 'Finish' : 'Next'}
        keyName="shift+→"
        onClick={onNext}
        clickable={clickable}
        compact
        primary
      />
      <Text color={theme.borderControl}>|</Text>
      <Button label="Skip onboarding" keyName="ctrl+k" onClick={onSkip} clickable={clickable} compact />
    </Box>
  );
}
