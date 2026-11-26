package windowmaterial

// The documented DWM system-backdrop API requires 22621. No undocumented
// legacy Mica attributes or Win10 blur fallbacks are used.
const minimumBackdropBuild = 22621

type windowsPolicy struct {
	build        uint32
	composition  bool
	transparency bool
	highContrast bool
	batterySaver bool
	dark         bool
	readFailed   bool
}

func backdropCapability(policy windowsPolicy) (bool, string) {
	switch {
	case policy.build < minimumBackdropBuild:
		return false, "原生云母需要 Windows 11 22H2（build 22621）及以上，正在使用经典外观"
	case policy.readFailed:
		return false, "无法检测 Windows 材质设置，正在使用经典外观"
	case !policy.composition:
		return false, "桌面合成不可用，正在使用经典外观"
	case policy.highContrast:
		return false, "系统已开启高对比度，正在使用经典外观"
	case !policy.transparency:
		return false, "系统已关闭透明效果，正在使用经典外观"
	case policy.batterySaver:
		return false, "系统已开启节电模式，正在使用经典外观"
	default:
		return true, ""
	}
}

// 优先级：云母、半透明（亚克力）、实色。系统允许效果时先选云母。
// 云母原生调用失败时，调用方再试半透明；系统不允许效果时直接实色。
func selectWindowsMaterial(policy windowsPolicy) (string, bool, string) {
	ok, reason := backdropCapability(policy)
	if ok {
		return "mica", true, ""
	}
	return "classic", false, reason
}
