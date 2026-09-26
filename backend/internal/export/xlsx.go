package export

import (
	"io"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
	"github.com/xuri/excelize/v2"
)

// WriteXLSX streams a real .xlsx workbook of the calculated route distances.
func WriteXLSX(w io.Writer, routes []geometry.Route, fields []string) error {
	f := excelize.NewFile()
	defer f.Close()
	sheet := "Routes"
	idx, err := f.NewSheet(sheet)
	if err != nil {
		return err
	}
	f.SetActiveSheet(idx)
	_ = f.DeleteSheet("Sheet1")

	head := header(fields)
	for c, v := range head {
		cell, _ := excelize.CoordinatesToCellName(c+1, 1)
		_ = f.SetCellValue(sheet, cell, v)
	}
	for i, r := range routes {
		vals := row(r, fields)
		for c, v := range vals {
			cell, _ := excelize.CoordinatesToCellName(c+1, i+2)
			_ = f.SetCellValue(sheet, cell, v)
		}
	}
	return f.Write(w)
}
