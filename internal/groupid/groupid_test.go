package groupid

import "testing"

func TestValidate(t *testing.T) {
	for _, value := range []string{"00-cdcp-alpha", "01-cdcp-main", "02-cdcp-logistics", "99-prod-1", "01-02"} {
		if err := Validate(value); err != nil {
			t.Errorf("Validate(%q) error: %v", value, err)
		}
	}
	for _, value := range []string{"cdcp", "1-cdcp", "001-cdcp", "01", "01-", "01--cdcp", "01-cdcp-", "01 cdcp", "01/cdcp", "02-cdcp-物流", "99-prod_1.v2", "01-cdcp#prod"} {
		if err := Validate(value); err == nil {
			t.Errorf("Validate(%q) unexpectedly succeeded", value)
		}
	}
}
