import { handleMathPaste } from '../utils/mathPasteHandler';

<textarea
  value={value}
  onChange={(e) => setValue(e.target.value)}
  onPaste={(e) => handleMathPaste(e, setValue)}
/>