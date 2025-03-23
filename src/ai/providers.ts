/**
 * Legacy providers module
 *
 * This file is maintained for backward compatibility.
 * New code should use provider.ts instead.
 */

import { model, trimPrompt as trimPromptFunc } from './provider';
import { RecursiveCharacterTextSplitter } from './text/splitter';

// Re-export the model for backward compatibility
export { model };

// Re-export the trimPrompt function for backward compatibility
export const trimPrompt = trimPromptFunc;