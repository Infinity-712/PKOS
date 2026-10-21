import assert from "node:assert/strict";
import { labels, messages, translateUiMessage } from "../i18n/copy.ts";

assert.deepEqual(labels.trusted, ["可信", "trusted"]);
assert.deepEqual(labels["Show answer"], ["显示答案", "Show answer"]);
assert.deepEqual(labels["上个月"], ["上个月", "Previous month"]);
assert.deepEqual(messages["Network result was unknown"], ["网络结果未知", "Network result was unknown"]);
assert.equal(labels["fact.private-user-id"], undefined);
assert.equal(messages["Unrecognized server response"], undefined);
assert.equal(translateUiMessage("Unrecognized server response", "zh-CN"), "Unrecognized server response");
assert.equal(translateUiMessage("network_unknown: Network result was unknown", "zh-CN"), "network_unknown: 网络结果未知");
assert.equal(translateUiMessage("Object ID is too short / 对象 ID 太短: 2/3", "en"), "Object ID is too short: 2/3");
assert.equal(translateUiMessage("Object ID is too short / 对象 ID 太短: 2/3", "zh-CN"), "对象 ID 太短：2/3");
assert.equal(translateUiMessage("rating 4, next review 2026-10-01, interval 7 days, ease 2.5", "zh-CN"), "评分 4，下次复习 2026-10-01，间隔 7 天，难度系数 2.5");
for (const entries of [labels, messages]) {
  for (const [key, pair] of Object.entries(entries)) {
    assert.equal(pair.length, 2, key);
    assert.ok(pair.every((value) => value.length > 0), key);
  }
}
console.log("LOCALE_COPY_SMOKE_OK");
