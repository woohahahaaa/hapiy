package relay

import (
	"testing"

	"github.com/hapiy/hapiy/internal/topology"
)

func TestSwitchEvalProviderFilter(t *testing.T) {
	eval := switchEvalFor(nil, nil)
	cfg := []byte(`{"mode":"provider","providers":["p-opencode"],"conditions":[]}`)
	if !eval(cfg, topology.SwitchEvalContext{ProviderID: "p-opencode"}) {
		t.Fatal("匹配供应商（记录 ID）应走「是」")
	}
	if !eval([]byte(`{"mode":"provider","providers":["opencode go"],"conditions":[]}`), topology.SwitchEvalContext{ProviderID: "p-opencode", ProviderName: "opencode go"}) {
		t.Fatal("旧版按名称绑定命中应走「是」")
	}
	if eval(cfg, topology.SwitchEvalContext{ProviderID: "p-moreai", ProviderName: "多元探索"}) {
		t.Fatal("未命中供应商应走「否」")
	}
	// 筛选列表留空 = 对全部供应商生效。
	cfgAll := []byte(`{"mode":"provider","providers":[],"conditions":[]}`)
	if !eval(cfgAll, topology.SwitchEvalContext{ProviderID: "anything"}) {
		t.Fatal("空筛选列表应无条件走「是」")
	}
}

func TestSwitchEvalModelFilter(t *testing.T) {
	eval := switchEvalFor(nil, nil)
	cfg := []byte(`{"mode":"model","models":["deepseek-chat"],"conditions":[]}`)
	if !eval(cfg, topology.SwitchEvalContext{Model: "deepseek-chat"}) {
		t.Fatal("匹配模型应走「是」")
	}
	if eval(cfg, topology.SwitchEvalContext{Model: "gpt-4"}) {
		t.Fatal("未命中模型应走「否」")
	}
}

func TestSwitchEvalHeaderCondition(t *testing.T) {
	cfg := []byte(`{"mode":"provider","providers":[],"conditions":[{"path":"header.X-Session","op":"eq","value":"abc","scope":"header"}]}`)
	if !switchEvalFor(map[string]string{"X-Session": "abc"}, nil)(cfg, topology.SwitchEvalContext{ProviderID: "p1"}) {
		t.Fatal("命中请求头条件应走「是」")
	}
	if switchEvalFor(map[string]string{"X-Session": "zzz"}, nil)(cfg, topology.SwitchEvalContext{ProviderID: "p1"}) {
		t.Fatal("未命中请求头条件应走「否」")
	}
}

func TestSwitchEvalBodyContainsCaseInsensitive(t *testing.T) {
	// 请求体 model = "MiniMax-M3"，条件 contains minimax：子串匹配不区分大小写。
	cfg := []byte(`{"mode":"provider","providers":[],"conditions":[{"path":"model","op":"contains","value":"minimax"}]}`)
	body := []byte(`{"model":"MiniMax-M3"}`)
	if !switchEvalFor(nil, body)(cfg, topology.SwitchEvalContext{}) {
		t.Fatal("contains 不区分大小写：MiniMax-M3 包含 minimax 应走「是」")
	}
	if switchEvalFor(nil, []byte(`{"model":"gpt-4o"}`))(cfg, topology.SwitchEvalContext{}) {
		t.Fatal("未包含子串应走「否」")
	}
	prefix := []byte(`{"mode":"provider","providers":[],"conditions":[{"path":"model","op":"prefix","value":"minimax"}]}`)
	if !switchEvalFor(nil, body)(prefix, topology.SwitchEvalContext{}) {
		t.Fatal("prefix 不区分大小写：MiniMax-M3 以 minimax 开头应走「是」")
	}
	suffix := []byte(`{"mode":"provider","providers":[],"conditions":[{"path":"model","op":"suffix","value":"-m3"}]}`)
	if !switchEvalFor(nil, body)(suffix, topology.SwitchEvalContext{}) {
		t.Fatal("suffix 不区分大小写：MiniMax-M3 以 -m3 结尾应走「是」")
	}
}

func TestSwitchEvalFilterOrCondition(t *testing.T) {
	// 用户场景：筛选只对 opencode go 生效 + 条件 model contains minimax。
	// 命中任一即走「是」：MiniMax-M3 请求（由非 opencode 供应商服务）应走「是」。
	cfg := []byte(`{"mode":"provider","providers":["p-opencode"],"conditions":[{"path":"model","op":"contains","value":"MiniMax"}]}`)
	bodyMiniMax := []byte(`{"model":"MiniMax-M3"}`)
	if !switchEvalFor(nil, bodyMiniMax)(cfg, topology.SwitchEvalContext{ProviderID: "p-moreai", ProviderName: "多元探索"}) {
		t.Fatal("条件命中（model 含 MiniMax）即使供应商不匹配也应走「是」")
	}
	if !switchEvalFor(nil, []byte(`{"model":"gpt-4o"}`))(cfg, topology.SwitchEvalContext{ProviderID: "p-opencode"}) {
		t.Fatal("筛选命中（opencode go）即使条件不匹配也应走「是」")
	}
	if switchEvalFor(nil, []byte(`{"model":"gpt-4o"}`))(cfg, topology.SwitchEvalContext{ProviderID: "p-moreai", ProviderName: "多元探索"}) {
		t.Fatal("筛选与条件都未命中应走「否」")
	}
}

func TestSwitchEvalQuotedStringValueCompat(t *testing.T) {
	// 历史数据：value 带引号（"\u0022MiniMax\u0022"），应被解开后命中。
	cfg := []byte(`{"mode":"provider","providers":[],"conditions":[{"path":"model","op":"contains","value":"\"MiniMax\""}]}`)
	if !switchEvalFor(nil, []byte(`{"model":"MiniMax-M3"}`))(cfg, topology.SwitchEvalContext{}) {
		t.Fatal("带引号的旧值应被解开并命中 MiniMax-M3")
	}
}

func TestSwitchEvalConditionLogicOR(t *testing.T) {
	cfg := []byte(`{"mode":"provider","providers":[],"conditionLogic":"OR","conditions":[{"path":"header.X-A","op":"eq","value":"1"},{"path":"header.X-B","op":"eq","value":"2"}]}`)
	if !switchEvalFor(map[string]string{"X-B": "2"}, nil)(cfg, topology.SwitchEvalContext{}) {
		t.Fatal("OR 下第二个条件命中应走「是」")
	}
	if switchEvalFor(map[string]string{"X-A": "x", "X-B": "x"}, nil)(cfg, topology.SwitchEvalContext{}) {
		t.Fatal("OR 下全部未命中应走「否」")
	}
}

func TestSwitchEvalEmptyConfigDefaultsYes(t *testing.T) {
	if !switchEvalFor(nil, nil)([]byte(`{"mode":"provider","providers":[],"conditions":[]}`), topology.SwitchEvalContext{ProviderID: ""}) {
		t.Fatal("空配置应默认走「是」")
	}
	if !switchEvalFor(nil, nil)([]byte(`{}`), topology.SwitchEvalContext{ProviderID: ""}) {
		t.Fatal("损坏/空对象配置应默认走「是」")
	}
}