package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

// userErr 将面向用户的错误转为中文可读文案（保留已有中文上下文）。
func userErr(err error) error {
	if err == nil {
		return nil
	}
	msg := localizeError(err)
	if msg == err.Error() {
		return err
	}
	return errors.New(msg)
}

func localizeError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()

	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		cn := describePathError(pathErr)
		eng := pathErr.Error()
		if msg == eng {
			return cn
		}
		if strings.Contains(msg, eng) {
			return strings.Replace(msg, eng, cn, 1)
		}
		return msg + "（" + cn + "）"
	}

	var linkErr *os.LinkError
	if errors.As(err, &linkErr) {
		cn := describeLinkError(linkErr)
		eng := linkErr.Error()
		if msg == eng {
			return cn
		}
		if strings.Contains(msg, eng) {
			return strings.Replace(msg, eng, cn, 1)
		}
		return msg + "（" + cn + "）"
	}

	// 无 PathError 包装时，仍替换常见英文系统句
	repl := []struct{ eng, cn string }{
		{"The system cannot find the path specified.", "系统找不到指定路径"},
		{"The system cannot find the file specified.", "系统找不到指定文件"},
		{"Access is denied.", "拒绝访问"},
		{"The process cannot access the file because it is being used by another process.", "文件正被其他进程占用"},
	}
	out := msg
	for _, r := range repl {
		out = strings.ReplaceAll(out, r.eng, r.cn)
	}
	return out
}

func describePathError(err *os.PathError) string {
	path := err.Path
	switch {
	case os.IsNotExist(err) || errors.Is(err.Err, fs.ErrNotExist) || isNotFoundDetail(err.Err):
		return fmt.Sprintf("路径不存在：%s", path)
	case os.IsPermission(err) || errors.Is(err.Err, fs.ErrPermission):
		return fmt.Sprintf("没有权限访问：%s", path)
	case os.IsExist(err) || errors.Is(err.Err, fs.ErrExist):
		return fmt.Sprintf("路径已存在：%s", path)
	}

	detail := strings.TrimSpace(err.Err.Error())
	detailCN := translateWindowsDetail(detail)
	op := translateFileOp(err.Op)
	if detailCN != "" {
		return fmt.Sprintf("%s失败：%s（%s）", op, path, detailCN)
	}
	return fmt.Sprintf("%s失败：%s", op, path)
}

func describeLinkError(err *os.LinkError) string {
	detail := translateWindowsDetail(strings.TrimSpace(err.Err.Error()))
	if detail == "" {
		detail = strings.TrimSpace(err.Err.Error())
	}
	op := translateFileOp(err.Op)
	if detail != "" {
		return fmt.Sprintf("%s失败：%s -> %s（%s）", op, err.Old, err.New, detail)
	}
	return fmt.Sprintf("%s失败：%s -> %s", op, err.Old, err.New)
}

func translateFileOp(op string) string {
	switch strings.ToLower(op) {
	case "open", "openfile":
		return "打开"
	case "stat", "lstat", "getfileattributesex":
		return "访问"
	case "create", "mkdir", "mkdirall":
		return "创建"
	case "remove", "removeall":
		return "删除"
	case "rename":
		return "重命名/移动"
	case "symlink", "createSymbolicLink":
		return "创建符号链接"
	case "readlink":
		return "读取链接"
	case "readdir", "readdirnames":
		return "读取目录"
	case "write", "writefile":
		return "写入"
	case "read", "readfile":
		return "读取"
	case "chmod", "chtimes":
		return "修改属性"
	default:
		if op == "" {
			return "文件操作"
		}
		return "文件操作(" + op + ")"
	}
}

func isNotFoundDetail(err error) bool {
	if err == nil {
		return false
	}
	d := strings.ToLower(err.Error())
	return strings.Contains(d, "cannot find the path") ||
		strings.Contains(d, "cannot find the file") ||
		strings.Contains(d, "no such file or directory")
}

func translateWindowsDetail(detail string) string {
	d := strings.TrimSuffix(detail, ".")
	switch {
	case strings.EqualFold(d, "The system cannot find the path specified"),
		strings.Contains(strings.ToLower(detail), "cannot find the path"):
		return "系统找不到指定路径"
	case strings.EqualFold(d, "The system cannot find the file specified"),
		strings.Contains(strings.ToLower(detail), "cannot find the file"):
		return "系统找不到指定文件"
	case strings.EqualFold(d, "Access is denied"),
		strings.Contains(strings.ToLower(detail), "access is denied"):
		return "拒绝访问"
	case strings.Contains(strings.ToLower(detail), "being used by another process"):
		return "文件正被其他进程占用"
	case strings.EqualFold(detail, "file already exists"),
		strings.EqualFold(detail, "file exists"):
		return "文件已存在"
	case strings.EqualFold(detail, "not a directory"):
		return "不是目录"
	case strings.EqualFold(detail, "is a directory"):
		return "是一个目录"
	default:
		return ""
	}
}
