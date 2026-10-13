import { Text } from 'ink';
import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text color="cyan">{FRAMES[frame]}</Text>;
}

/** A spinner with a label, for screens waiting on a service. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Text>
      <Spinner /> {label}
    </Text>
  );
}
