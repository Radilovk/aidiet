# Fix: JSON Parsing Error in /api/generate-plan

## Problem

Users were experiencing a JSON parsing error when calling `/api/generate-plan`:

```
"All JSON parsing attempts failed: Expected ',' or ']' after array element in JSON at position 7390 (line 58 column 5)"
```

This error occurred when the AI model (OpenAI or Gemini) returned malformed JSON with structural issues.

## Root Cause

The AI models occasionally generate JSON responses with formatting issues such as:
- Missing commas between array elements: `[{...}{...}]` instead of `[{...},{...}]`
- Missing commas between object properties
- Trailing commas: `[1, 2, 3,]`
- Duplicate commas: `[1,, 2]`

The original `sanitizeJSON` function only handled trailing commas, which was insufficient for the variety of formatting errors that could occur.

## Solution

### 1. Enhanced `sanitizeJSON` Function

The function now handles multiple types of JSON formatting issues:

```javascript
function sanitizeJSON(jsonStr) {
  let result = jsonStr;
  
  // 1. Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');
  
  // 2. Remove duplicate commas (,,)
  result = result.replace(/,\s*,+/g, ',');
  
  // 3. Fix missing comma between consecutive objects in arrays
  // Pattern: }\s*{ -> },{
  result = result.replace(/}(\s*){/g, '},$1{');
  
  // 4. Fix missing comma between consecutive arrays
  // Pattern: ]\s*[ -> ],[
  result = result.replace(/](\s*)\[/g, '],$1[');
  
  // 5. Fix missing comma between object and array
  // Pattern: }\s*[ -> },[
  result = result.replace(/}(\s*)\[/g, '},$1[');
  
  // 6. Fix missing comma between array and object
  // Pattern: ]\s*{ -> ],{
  result = result.replace(/](\s*){/g, '],$1{');
  
  return result;
}
```

### 2. Improved Error Logging

Added contextual error logging to help diagnose future issues:

```javascript
// Extract position from error message if available
const posMatch = e.message.match(/position (\d+)/);
if (posMatch) {
  const errorPos = parseInt(posMatch[1]);
  const contextStart = Math.max(0, errorPos - 100);
  const contextEnd = Math.min(jsonMatch[0].length, errorPos + 100);
  console.error('Context around error position:', jsonMatch[0].substring(contextStart, contextEnd));
}
```

### 3. Security Improvement

Removed raw response data from error messages sent to clients:
- Before: `{ error: "...", raw: response }`
- After: `{ error: "All JSON parsing attempts failed: ..." }`

This prevents potential exposure of sensitive data in error messages.

## Testing

All test cases pass successfully:

```
✓ Missing comma between array elements
✓ Trailing comma
✓ Duplicate commas
✓ Complex nested structure with missing comma
✓ Valid JSON (should pass)
✓ JSON in markdown code block
✓ JSON with trailing text
```

## Files Changed

- `worker.js`: Enhanced `sanitizeJSON` function and improved error handling in `parseAIResponse`

## Impact

This fix should significantly reduce JSON parsing errors in the `/api/generate-plan` endpoint by automatically correcting common AI-generated JSON formatting issues before parsing.

## Future Improvements

If issues persist, consider:
1. Adding more specific prompts to guide the AI to produce valid JSON
2. Implementing a JSON repair library for more complex cases
3. Adding retry logic with corrective feedback to the AI
4. Validating the JSON structure before sending it to the parser
