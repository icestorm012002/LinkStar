package main; import ("fmt"; "path/filepath"); func main() { p, _ := filepath.Abs(filepath.Join("default", "users", "test")); fmt.Println(p) }
