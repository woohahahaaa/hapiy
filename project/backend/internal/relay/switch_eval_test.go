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