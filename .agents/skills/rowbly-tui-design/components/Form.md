# Form

A Form is a set of fields with labels, in a Modal. Use it to create or edit a record.

- The Form starts with a help line in `ink-faint`.
- Field in focus: the `›` marker and the label are in `accent`, and the input is on `field-focus`. Other fields: the label is in `ink-muted`, and the input is on `field`. The label of a mandatory field ends in `*`.
- Placeholders are in `ink-faint`. A validation message shows below its field as `!` and text in `danger`.
- Do not put a Save button in the Form. A key (`ctrl+s`) saves the record, and the hint strip of the Modal shows this key. This keeps all the keys in one place.
