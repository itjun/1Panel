package app

import (
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// saveDialogInitialName 是保存框 Name 栏要预填的文件名。
// 门户只接受不含目录的名字，带上路径时 Name 栏会是空的。
func saveDialogInitialName(filename string) string {
	name := filepath.Base(filename)
	if name == "." || name == ".." {
		return ""
	}
	return name
}

// promptSaveFile 弹出系统保存框。
// Linux GTK4 上 Wails 不会把 SetFilename 交给 GtkFileDialog，这里另外补上。
func promptSaveFile(dialog *application.SaveFileDialogStruct, filename string) (string, error) {
	setLinuxSaveInitialName(saveDialogInitialName(filename))
	defer setLinuxSaveInitialName("")
	return dialog.PromptForSingleSelection()
}
