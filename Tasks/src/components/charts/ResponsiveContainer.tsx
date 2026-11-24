import { ResponsiveContainer as Base } from 'recharts';
import type { ComponentProps } from 'react';

/** Until the first measurement; recharts' own default of -1 × -1 warns on every mount. */
const INITIAL_DIMENSION = { width: 1, height: 1 };

/** Use this instead of recharts' ResponsiveContainer. */
export function ResponsiveContainer(props: ComponentProps<typeof Base>) {
  return <Base initialDimension={INITIAL_DIMENSION} {...props} />;
}
