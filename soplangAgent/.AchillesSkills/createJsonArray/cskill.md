# createJsonArray

## Description
Takes a list of arguments and returns a single string containing the JSON representation of an array of those arguments.

## Usage
`@myJsonArray createJsonArray $arg1 $arg2 "a literal string" ...`

## Parameters
- `...`: A variable number of arguments to be included in the JSON array.

## Returns
A string containing the JSON array.
`"[\"value1\",\"value2\",\"a literal string\"]"`
