# Quest Schedule Parsing Documentation

## Sample Quest Schedule Format

Based on actual UWaterloo Quest schedule (Fall 2025):

```
CO 250 - Intro Optimization
ECON 101 - Intro Microeconomics
MATH 235 - Linear Algebra 2 (Honours)
MATH 237 - Calculus 3 (Honours)
MATH 239 - Intro Combinatorics
```

## Course Code Pattern

**Regex Pattern**: `/[A-Z]{2,4}\s*\d{3}[A-Z]?/gi`

### Pattern Breakdown:
- `[A-Z]{2,4}` - Department code (2-4 uppercase letters)
  - Examples: CO, ECON, MATH, CS, ECE
- `\s*` - Optional whitespace
- `\d{3}` - Three digit course number
- `[A-Z]?` - Optional letter suffix
- `gi` flags - Global, case-insensitive

### Examples Matched:
- ✅ CO 250
- ✅ ECON 101
- ✅ MATH 235
- ✅ MATH 237
- ✅ MATH 239
- ✅ CS 136
- ✅ ECE 105

## Parsing Strategy

1. **User pastes full Quest schedule** (including all the metadata)
2. **Extract course codes using regex**
3. **Deduplicate** (remove duplicates)
4. **Normalize** (ensure consistent spacing: "MATH 237" not "MATH237")
5. **Display as chips** for user confirmation
6. **Allow manual add/remove**

## Implementation Notes

- Quest format includes lots of metadata (times, rooms, instructors, dates)
- We only need the course codes
- Users may paste entire schedule or just course list
- Should handle both formats gracefully
- Case-insensitive matching (convert to uppercase)
