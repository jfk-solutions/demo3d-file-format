param([string]$SdkPath = 'C:/Program Files (x86)/Emulate3D 2026')
$ErrorActionPreference = 'Stop'
$rawAssembly = [Reflection.Assembly]::LoadFrom((Join-Path $SdkPath 'Demo3D.Raw.dll'))
function New-Raw([string]$name) { [Activator]::CreateInstance($rawAssembly.GetType("Demo3D.Raw.$name", $true)) }
function Initialize-List($owner, [string]$name) {
    $field = $owner.GetType().GetField($name)
    $field.SetValue($owner, [Activator]::CreateInstance($field.FieldType))
}
$scene = New-Raw 'Scene'
foreach ($name in @('Nodes','Meshes','Materials','Lights','Buttons','Updates')) { Initialize-List $scene $name }
$node = New-Raw 'Node'; $node.Index = 0; $node.Name = 'Fixture'; $scene.Nodes.Add($node)
$mesh = New-Raw 'Mesh'; Initialize-List $mesh 'Bones'
$bone = New-Raw 'Bone'; $bone.Name = 'Arm'; $bone.Parent = 0; $bone.SkinIndexBuffer = 1; $bone.SkinWeightsVertexBuffer = 2
$bone.L = '1 2 3'; $bone.R = '0 0 0.5'; $mesh.Bones.Add($bone); $scene.Meshes.Add($mesh)
$material = New-Raw 'Material'; $material.Diffuse = [uint32]0x3300ff00; $material.Shader = 2; $material.NormalDepth = 0.1; $material.Luminosity = 0.5; $scene.Materials.Add($material)
$light = New-Raw 'Light'; $light.Index = 0; $light.Node = 0; $light.Enabled = $true; $light.Type = 2; $light.SpotlightInnerAngle = 0.2; $light.SpotlightOuterAngle = 0.6; $light.SpotlightFalloff = 2; $scene.Lights.Add($light)
$button = New-Raw 'UIButton'; $button.Index = 0; $button.Name = 'Run'; $button.IsVisible = $true; $scene.Buttons.Add($button)
function Add-Update([string]$name, $values) {
    $update = New-Raw $name
    $update.Time = [double[]]@(0, 1)
    $property = $update.GetType().GetProperty('Value')
    $typed = [Array]::CreateInstance($property.PropertyType.GetElementType(), 2)
    for ($index = 0; $index -lt 2; $index++) { $typed.SetValue([Convert]::ChangeType($values[$index], $property.PropertyType.GetElementType(), [Globalization.CultureInfo]::InvariantCulture), $index) }
    $property.SetValue($update, $typed)
    $scene.Updates.Add($update)
    return $update
}
$null = Add-Update 'UpdateUserData' @('hello world', '{"message":"a b"}')
$null = Add-Update 'UpdateLightType' @(1, 2)
$null = Add-Update 'UpdateLightEnabled' @($true, $false)
$null = Add-Update 'UpdateLightAttenuationRange' @(5.0, 10.0)
$null = Add-Update 'UpdateSceneUseDefaultLighting' @($true, $false)
$null = Add-Update 'UpdateSceneAmbientLightColorR' @(0.0, 1.0)
$uiVisible = Add-Update 'UpdateUIVisible' @($true, $false); $scene.Updates.Remove($uiVisible) | Out-Null
$uiChecked = Add-Update 'UpdateUIChecked' @($false, $true); $scene.Updates.Remove($uiChecked) | Out-Null
$update = Add-Update 'UpdateMaterial' @('0', '1'); $update.Name = 'Texture'; $update.Index = 0
$update = Add-Update 'UpdateLightMaterial' @('FFFFFFFF', 'FFFF0000'); $update.Name = 'Diffuse'
$output = Join-Path $PSScriptRoot '../test/fixtures/native-features.xml'
$null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
$settings = [Xml.XmlWriterSettings]::new(); $settings.Indent = $true; $settings.NewLineChars = [string][char]10; $settings.Encoding = [Text.UTF8Encoding]::new($false)
$writer = [Xml.XmlWriter]::Create($output, $settings)
try { ([Xml.Serialization.XmlSerializer]::new($scene.GetType())).Serialize($writer, $scene) } finally { $writer.Dispose() }
# Scene's XmlArrayItem declarations omit UI updates, although their individual
# public serializers work. Preserve those native element names in the fixture.
$document = [Xml.XmlDocument]::new(); $document.Load($output)
foreach ($update in @($uiVisible, $uiChecked)) {
    $text = [IO.StringWriter]::new()
    ([Xml.Serialization.XmlSerializer]::new($update.GetType())).Serialize($text, $update)
    $fragment = [Xml.XmlDocument]::new(); $fragment.LoadXml($text.ToString())
    $null = $document.Scene.Updates.AppendChild($document.ImportNode($fragment.DocumentElement, $true))
}
$writer = [Xml.XmlWriter]::Create($output, $settings)
try { $document.Save($writer) } finally { $writer.Dispose() }
Write-Output "Generated $output using the native Raw SDK serializer."
