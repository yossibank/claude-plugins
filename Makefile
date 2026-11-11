.PHONY: verify validate types versions descriptions defaults test

verify:
	@failed=0; \
	for target in validate versions descriptions defaults; do \
		$(MAKE) --no-print-directory $$target || failed=1; \
	done; \
	exit $$failed

validate:
	@out=$$(claude plugin validate . 2>&1) || { echo "$$out"; echo "NG claude plugin validate"; exit 1; }; \
	echo "OK claude plugin validate"

types:
	@command -v tsc >/dev/null || { echo "NG tsc が無い（npm i -g typescript）"; exit 1; }; \
	failed=0; \
	for dir in plugins/*/; do \
		[ -f "$$dir.claude-plugin/types/tsconfig.json" ] || { echo "NG $$dir に .claude-plugin/types/tsconfig.json が無い（claude --plugin-dir $$dir で一度読み込むと作られる）"; failed=$$((failed + 1)); continue; }; \
		out=$$(tsc -p "$$dir" 2>&1) && echo "OK tsc $$dir" || { echo "$$out"; echo "NG tsc $$dir"; failed=$$((failed + 1)); }; \
	done; \
	[ $$failed -eq 0 ] || { echo "NG 型が通らないプラグイン: $$failed 本"; exit 1; }

versions:
	@base=$$(git merge-base origin/HEAD HEAD 2>/dev/null) || { echo "NG origin/HEAD が無い（git remote set-head origin -a）"; exit 1; }; \
	failed=0; \
	for dir in plugins/*/; do \
		json="$$dir.claude-plugin/plugin.json"; \
		git cat-file -e "$$base:$$json" 2>/dev/null || continue; \
		old=$$(git show "$$base:$$json"); \
		[ -n "$$(git diff --name-only "$$base" -- "$$dir"hooks)" ] || [ "$$(printf "%s" "$$old" | jq -c '.userConfig')" != "$$(jq -c '.userConfig' "$$json")" ] || continue; \
		[ "$$(printf "%s" "$$old" | jq -r '.version')" != "$$(jq -r '.version' "$$json")" ] || { echo "NG $$dir は hooks か userConfig を変えたのに version が同じ（plugin.json の version を上げる）"; failed=$$((failed + 1)); }; \
	done; \
	[ $$failed -eq 0 ] || exit 1; \
	echo "OK version の上げ忘れ"

descriptions:
	@failed=0; \
	for dir in plugins/*/; do \
		name=$$(jq -r '.name' "$$dir.claude-plugin/plugin.json"); \
		listed=$$(jq -r --arg name "$$name" '.plugins[] | select(.name == $$name) | .description' .claude-plugin/marketplace.json); \
		[ "$$listed" = "$$(jq -r '.description' "$$dir.claude-plugin/plugin.json")" ] || { echo "NG $$name の description が marketplace.json と plugin.json で違う"; failed=$$((failed + 1)); }; \
	done; \
	[ $$failed -eq 0 ] || exit 1; \
	echo "OK description の一致"

defaults:
	@out=$$(for dir in plugins/*/; do \
		jq -r '.userConfig // {} | to_entries[] | .key, (if (.value.default | type) == "string" then "'"'"'" + (.value.default | tojson | .[1:-1]) + "'"'"'" else (.value.default | tostring) end)' "$$dir.claude-plugin/plugin.json" | \
		while read -r key && read -r value; do \
			grep -qF -- "$$key: $$value" "$$dir"hooks/*.ts* || echo "NG $$dir の $${key} の既定値がコードの DEFAULTS に無い（$${value}）"; \
		done; \
	done); \
	[ -z "$$out" ] || { echo "$$out"; exit 1; }; \
	echo "OK userConfig の既定値とコードの一致"

test:
	@failed=0; \
	for dir in plugins/*/; do \
		out=$$(claude plugin test "$$dir" 2>&1) && echo "OK $$dir" || { echo "$$out"; echo "NG $$dir"; failed=$$((failed + 1)); }; \
	done; \
	[ $$failed -eq 0 ] || { echo "NG 落ちたプラグイン: $$failed 本"; exit 1; }
