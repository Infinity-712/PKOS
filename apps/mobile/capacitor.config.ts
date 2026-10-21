import type { CapacitorConfig } from '@capacitor/cli';
import { capacitorConfig } from './scripts/network.mjs';

export default capacitorConfig(false) satisfies CapacitorConfig;
