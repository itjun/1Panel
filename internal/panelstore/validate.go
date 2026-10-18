package panelstore

// ValidateSnapshot checks backup data without loading, migrating or quarantining
// any live file. Restore must reject invalid models before replacing data.
func ValidateSnapshot(content []byte) error {
	var state State
	_, err := decodeState(content, &state)
	return err
}
