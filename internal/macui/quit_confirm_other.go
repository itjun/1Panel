//go:build !darwin

package macui

// QuitConfirmAction 用户在退出确认框中的选择（非 macOS 由 Wails 对话框处理）。
type QuitConfirmAction int

const (
	QuitConfirmQuit       QuitConfirmAction = 0
	QuitConfirmBackground QuitConfirmAction = 1
	QuitConfirmCancel     QuitConfirmAction = 2
)

// ShowQuitConfirm 非 Darwin 不提供原生实现；ok=false 时由调用方走 Wails 对话框。
func ShowQuitConfirm(askChecked bool, quitShortcutLabel string) (action QuitConfirmAction, askAgain bool, ok bool) {
	return QuitConfirmCancel, askChecked, false
}
