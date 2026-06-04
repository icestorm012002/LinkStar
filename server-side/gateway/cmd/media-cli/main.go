package main

import (
	"flag"
	"fmt"
	"os"

	"agent-cloud-os/server/orchestrator"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: media-cli <category> <engine_id> [flags]")
		fmt.Println("Available categories and engines:")
		for category, engines := range orchestrator.MediaEngines {
			fmt.Printf("\n[%s]\n", category)
			for _, e := range engines {
				fmt.Printf("  - %s (%s)\n", e.ID, e.Name)
			}
		}
		os.Exit(1)
	}

	categoryName := os.Args[1]
	engineID := os.Args[2]

	engines, categoryExists := orchestrator.MediaEngines[categoryName]
	if !categoryExists {
		fmt.Printf("Error: Unknown category '%s'\n", categoryName)
		os.Exit(1)
	}

	var targetEngine *orchestrator.Engine
	for _, e := range engines {
		if e.ID == engineID {
			targetEngine = &e
			break
		}
	}

	if targetEngine == nil {
		fmt.Printf("Error: Unknown engine '%s' in category '%s'\n", engineID, categoryName)
		os.Exit(1)
	}

	// Create a new FlagSet for the specific engine
	fs := flag.NewFlagSet(fmt.Sprintf("%s:%s", categoryName, engineID), flag.ExitOnError)

	// Global output directory flag
	outputDir := fs.String("output", "./output", "Global output directory path")

	// Dynamically register all flags from the specific engine
	for _, p := range targetEngine.Parameters {
		p.RegisterFlag(fs)
	}

	// Parse flags specific to the engine
	err := fs.Parse(os.Args[3:])
	if err != nil {
		fmt.Printf("Error parsing flags: %v\n", err)
		os.Exit(1)
	}

	// Output summary of parsed values
	fmt.Printf("\n[Media CLI Execution]\n")
	fmt.Printf("Category: %s\n", categoryName)
	fmt.Printf("Engine: %s (%s)\n", targetEngine.ID, targetEngine.Name)
	fmt.Printf("Output Directory: %s\n", *outputDir)
	fmt.Printf("Parameters:\n")
	
	// Create subdirectories automatically
	ensureDir(*outputDir, "image")
	ensureDir(*outputDir, "audio")
	ensureDir(*outputDir, "video")

	// Print all parsed values
	fs.VisitAll(func(f *flag.Flag) {
		if f.Name != "output" {
			fmt.Printf("  --%s = %s\n", f.Name, f.Value.String())
		}
	})

	fmt.Println("\nSuccess: Command executed.")
}

func ensureDir(baseDir, subDir string) {
	path := fmt.Sprintf("%s/%s", baseDir, subDir)
	err := os.MkdirAll(path, 0755)
	if err != nil {
		fmt.Printf("Failed to create directory %s: %v\n", path, err)
	} else {
		fmt.Printf("Ensured directory: %s\n", path)
	}
}
