.PHONY: verify test

verify:
	@out=$$(claude plugin validate . 2>&1) || { echo "$$out"; echo "NG claude plugin validate"; exit 1; }; \
	echo "OK claude plugin validate"

test:
	@failed=0; \
	for dir in plugins/*/; do \
		out=$$(claude plugin test "$$dir" 2>&1) && echo "OK $$dir" || { echo "$$out"; echo "NG $$dir"; failed=$$((failed + 1)); }; \
	done; \
	[ $$failed -eq 0 ] || { echo "NG 落ちたプラグイン: $$failed 本"; exit 1; }
