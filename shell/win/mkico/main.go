// mkico — 把 PNG 打包成 ICO（PNG-in-ICO 条目，Vista+ 支持）。
// 用法: go run ./mkico icon-512.png icon.ico
package main

import (
	"encoding/binary"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "用法: mkico <in.png> <out.ico>")
		os.Exit(2)
	}
	png, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// PNG: 8 字节签名 + IHDR(len4 + "IHDR" + w4 + h4)
	if len(png) < 24 || string(png[12:16]) != "IHDR" {
		fmt.Fprintln(os.Stderr, "不是有效 PNG")
		os.Exit(1)
	}
	w := binary.BigEndian.Uint32(png[16:20])
	h := binary.BigEndian.Uint32(png[20:24])
	fmt.Printf("PNG %dx%d, %d bytes\n", w, h, len(png))

	// ICO 头: reserved(2)=0, type(2)=1, count(2)=1
	ico := []byte{0, 0, 1, 0, 1, 0}
	// 目录项: w,h (0 表示 256), 色板 0, 保留 0, planes 1, bitcount 32
	ico = append(ico, 0, 0, 0, 0, 1, 0, 32, 0)
	ico = binary.LittleEndian.AppendUint32(ico, uint32(len(png)))
	ico = binary.LittleEndian.AppendUint32(ico, 22)
	ico = append(ico, png...)

	if err := os.WriteFile(os.Args[2], ico, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("wrote", os.Args[2])
}
